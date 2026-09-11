"""Character emotion and match transaction regressions; no network or save writes.

Run: python -B -m unittest discover -s demo/tests -v
"""
import concurrent.futures
import importlib.util
from pathlib import Path
import threading
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "character_test_server", Path(__file__).resolve().parents[1] / "server.py")
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class CharacterEventTests(unittest.TestCase):
    def setUp(self):
        # Keep tests independent of local credentials, player progress and NPC saves.
        for target, value in (("LLM_MODE", "mock"), ("LLM_OPENING", False),
                              ("sessions", {}), ("NPC_STATE", {})):
            patcher = mock.patch.object(server, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for target in ("_chat", "_save_progress"):
            patcher = mock.patch.object(server, target, side_effect=AssertionError(
                "Tests must not call network or save progress"))
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(server, "_save_npc_state")
        self.save = patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(server, "_save_account_state")
        self.account_save = patcher.start()
        self.addCleanup(patcher.stop)

    def session(self, memory_on=True):
        created = server.new_session(tier=1, npc_id="L1_A", memory_on=memory_on)
        return created["sid"], server.sessions[created["sid"]]

    @staticmethod
    def verdict(strength="L3"):
        return {"dimension": "EVIDENCE", "strength": strength, "confidence": 0.9}

    def test_winning_hit_overrides_yield_and_exhausted_tokens(self):
        sid, state = self.session()
        state["confidence"] = 40
        state["token_remaining"] = 1
        with mock.patch.object(server, "judge", side_effect=lambda *a: self.verdict()):
            response = server.process_message(sid, "这组数据可以验证我的观点。")
        self.assertEqual(response["next"]["status"], "WIN")
        self.assertEqual(response["beat"], "CONCEDE")
        self.assertEqual(response["emotion"], {"npc": "被说服", "player": "从容"})
        self.assertEqual(response["objection_event"]["side"], "player")
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.save.assert_called_once()

    def test_all_message_losses_use_terminal_emotion(self):
        for result in ("LOSE_TOKEN", "LOSE_TURN", "LOSE_TIME"):
            with self.subTest(result=result):
                sid, state = self.session(memory_on=False)
                if result == "LOSE_TOKEN":
                    state["token_remaining"] = 1
                elif result == "LOSE_TURN":
                    state["turn"] = server.MAX_TURN - 1
                else:
                    state["start_time"] -= server.TIME_LIMIT_S + 1
                with mock.patch.object(server, "judge", side_effect=lambda *a: self.verdict()):
                    response = server.process_message(sid, "请看证据。")
                self.assertEqual(response["next"]["status"], result)
                self.assertEqual(response["emotion"], {"npc": "得意", "player": "绝望"})
        self.save.assert_not_called()

    def test_ongoing_resource_thresholds_remain_unchanged(self):
        _, state = self.session()
        for ratio, expected in ((1, "从容"), (.75, "从容"), (.749, "紧张"),
                                (.5, "紧张"), (.499, "焦虑"), (.35, "焦虑"),
                                (.349, "绝望")):
            with self.subTest(ratio=ratio):
                state["token_remaining"] = state["npc"]["token_quota"] * ratio
                self.assertEqual(server._emotion(state, "TALK")["player"], expected)
        self.assertEqual(server._emotion(state, "YIELD")["npc"], "动摇")

    def test_timeout_retries_keep_one_memory_and_report_emotion(self):
        sid, state = self.session()
        first = server.timeout_session(sid)
        history_count = len(state["history"])
        repeated = server.timeout_session(sid)
        self.assertEqual(first["result"], "LOSE_TIME")
        self.assertEqual(first["emotion"], {"npc": "得意", "player": "绝望"})
        self.assertEqual(repeated["emotion"], first["emotion"])
        self.assertEqual(repeated["retrospect"], first["retrospect"])
        self.assertEqual(repeated["npc_reply"], "")
        self.assertEqual(len(state["history"]), history_count)
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.assertEqual(len(server.NPC_STATE["L1_A"]["memories"]), 1)
        self.save.assert_called_once()

    def test_finalize_is_idempotent_and_does_not_finalize_ongoing(self):
        _, state = self.session()
        server._finalize_match(state)
        self.assertEqual(server.NPC_STATE, {})
        state["result"] = "WIN"
        state["hit_stats"] = {"EVIDENCE": 2}
        server._finalize_match(state)
        server._finalize_match(state)
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.assertEqual(server.NPC_STATE["L1_A"]["adj"]["EVIDENCE"], .3)
        self.assertEqual(len(server.NPC_STATE["L1_A"]["memories"]), 1)
        self.save.assert_called_once()

    def test_surrender_finishes_server_session_once(self):
        sid, state = self.session()
        first = server.surrender_session(sid)
        history_count = len(state["history"])
        repeated = server.surrender_session(sid)
        self.assertEqual(first["result"], "LOSE_SURRENDER")
        self.assertIn("认输", first["npc_reply"])
        self.assertEqual(first["emotion"], {"npc": "得意", "player": "绝望"})
        self.assertEqual(repeated["result"], first["result"])
        self.assertEqual(repeated["retrospect"], first["retrospect"])
        self.assertEqual(repeated["npc_reply"], "")
        self.assertEqual(len(state["history"]), history_count)
        self.assertEqual(server.process_message(sid, "再发一句")["error"], "session already ended")
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.save.assert_called_once()

    def test_surrender_after_win_preserves_win(self):
        sid, state = self.session()
        state["confidence"] = 40
        with mock.patch.object(server, "judge", side_effect=lambda *a: self.verdict()):
            winning = server.process_message(sid, "证据就在这里。")
        response = server.surrender_session(sid)
        self.assertEqual(response["result"], "WIN")
        self.assertEqual(response["emotion"], winning["emotion"])
        self.assertEqual(response["retrospect"], winning["retrospect"])
        self.assertEqual(response["npc_reply"], "")
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.save.assert_called_once()

    def test_account_match_reserves_quota_and_refunds_unused_tokens(self):
        accounts = {"token-player": {
            "account_id": "token-player", "account_token": 500, "callback_secret": "secret",
            "events": [], "callback_ids": [], "registered": True,
        }}
        with mock.patch.object(server, "_ACCOUNT_STATE", accounts):
            created = server.new_session(tier=1, npc_id="L1_A",
                                         player_ctx={"mode": "account", "account_id": "token-player"})
            self.assertEqual(created["account"]["after"], 80)
            state = server.sessions[created["sid"]]
            self.assertEqual(state["account_reserved_tokens"], 420)
            state["token_remaining"] = 37
            state["result"] = "WIN"
            server._finalize_match(state)
            self.assertEqual(accounts["token-player"]["account_token"], 117)
            self.assertEqual(state["_account_settlement"]["delta"], 37)

    def test_account_match_is_rejected_without_full_quota(self):
        accounts = {"poor-player": {
            "account_id": "poor-player", "account_token": 419, "callback_secret": "secret",
            "events": [], "callback_ids": [], "registered": True,
        }}
        with mock.patch.object(server, "_ACCOUNT_STATE", accounts):
            response = server.new_session(tier=1, npc_id="L1_A",
                                           player_ctx={"mode": "account", "account_id": "poor-player"})
        self.assertEqual(response["error"], "token-insufficient")
        self.assertEqual(response["required_tokens"], 420)
        self.assertEqual(response["missing_tokens"], 1)
        self.assertEqual(accounts["poor-player"]["account_token"], 419)

    def test_abandoned_account_match_is_a_failure_and_refunds_remaining(self):
        accounts = {"exit-player": {
            "account_id": "exit-player", "account_token": 500, "callback_secret": "secret",
            "events": [], "callback_ids": [], "registered": True,
        }}
        with mock.patch.object(server, "_ACCOUNT_STATE", accounts):
            created = server.new_session(tier=1, npc_id="L1_A",
                                         player_ctx={"mode": "account", "account_id": "exit-player"})
            state = server.sessions[created["sid"]]
            state["token_remaining"] = 123
            response = server.abandon_session(created["sid"])
            repeated = server.abandon_session(created["sid"])
        self.assertEqual(response["result"], "LOSE_EXIT")
        self.assertEqual(response["account_settlement"]["delta"], 123)
        self.assertEqual(repeated["result"], "LOSE_EXIT")
        self.assertEqual(accounts["exit-player"]["account_token"], 203)

    def test_surrender_route_returns_the_server_result(self):
        sid, state = self.session(memory_on=False)
        # Exercise HTTP dispatch without opening a socket or starting a server.
        handler = server.Handler.__new__(server.Handler)
        handler.path = "/api/surrender"
        handler._read_body = lambda: {"sid": sid}
        handler._send = mock.Mock()
        handler.do_POST()
        status, response = handler._send.call_args.args
        self.assertEqual(status, 200)
        self.assertEqual(response["result"], "LOSE_SURRENDER")
        self.assertEqual(state["result"], "LOSE_SURRENDER")
        self.assertEqual(response["emotion"]["player"], "绝望")
        self.save.assert_not_called()

    def test_message_and_timeout_cannot_settle_the_same_match_twice(self):
        sid, state = self.session()
        state["confidence"] = 40
        judge_started = threading.Event()
        timeout_started = threading.Event()
        release_judge = threading.Event()

        def slow_judge(*args):
            judge_started.set()
            if not release_judge.wait(3):
                raise AssertionError("Judge was never released")
            return self.verdict()

        def timeout():
            timeout_started.set()
            return server.timeout_session(sid)

        with mock.patch.object(server, "judge", side_effect=slow_judge), \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            message = pool.submit(server.process_message, sid, "可核实的证据。")
            try:
                self.assertTrue(judge_started.wait(1))
                timed = pool.submit(timeout)
                self.assertTrue(timeout_started.wait(1))
                with self.assertRaises(concurrent.futures.TimeoutError):
                    timed.result(timeout=.15)
            finally:
                release_judge.set()
            response = message.result(timeout=2)
            timeout_response = timed.result(timeout=2)
        self.assertEqual(response["next"]["status"], "WIN")
        self.assertEqual(timeout_response["result"], "WIN")
        self.assertEqual(timeout_response["emotion"], response["emotion"])
        self.assertEqual(timeout_response["npc_reply"], "")
        self.assertEqual(len(state["history"]), 3)
        self.assertEqual(server.NPC_STATE["L1_A"]["fights"], 1)
        self.assertEqual(len(server.NPC_STATE["L1_A"]["memories"]), 1)
        self.save.assert_called_once()

    def test_two_messages_cannot_both_finish_one_match(self):
        sid, state = self.session()
        state["confidence"] = 40
        judge_started = threading.Event()
        second_started = threading.Event()
        release_judge = threading.Event()

        def slow_judge(*args):
            judge_started.set()
            if not release_judge.wait(3):
                raise AssertionError("Judge was never released")
            return self.verdict()

        def second_message():
            second_started.set()
            return server.process_message(sid, "第二句证据。")

        with mock.patch.object(server, "judge", side_effect=slow_judge) as judge, \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(server.process_message, sid, "第一句证据。")
            try:
                self.assertTrue(judge_started.wait(1))
                second = pool.submit(second_message)
                self.assertTrue(second_started.wait(1))
                with self.assertRaises(concurrent.futures.TimeoutError):
                    second.result(timeout=.15)
            finally:
                release_judge.set()
            self.assertEqual(first.result(timeout=2)["next"]["status"], "WIN")
            self.assertEqual(second.result(timeout=2)["error"], "session already ended")
        self.assertEqual(state["turn"], 1)
        judge.assert_called_once()
        self.save.assert_called_once()

    def test_slow_session_does_not_block_another_session(self):
        first_sid, _ = self.session()
        other_sid, _ = self.session()
        judge_started = threading.Event()
        release_judge = threading.Event()

        def slow_judge(*args):
            judge_started.set()
            if not release_judge.wait(3):
                raise AssertionError("Judge was never released")
            return self.verdict()

        with mock.patch.object(server, "judge", side_effect=slow_judge), \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(server.process_message, first_sid, "请看证据。")
            try:
                self.assertTrue(judge_started.wait(1))
                other = pool.submit(server.timeout_session, other_sid)
                self.assertEqual(other.result(timeout=1)["result"], "LOSE_TIME")
                self.assertFalse(first.done())
            finally:
                release_judge.set()
            self.assertEqual(first.result(timeout=2)["next"]["status"], "ONGOING")


if __name__ == "__main__":
    unittest.main()
