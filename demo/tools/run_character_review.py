"""Isolated local mock server; never writes the player's actual progress or calls an AI API."""
import argparse
import importlib.util
import os
from pathlib import Path
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "work" / "character-audit" / "mock-data"
WORK.mkdir(parents=True, exist_ok=True)
os.environ["TMP"] = os.environ["TEMP"] = str(WORK)
spec = importlib.util.spec_from_file_location("debate_review_server", ROOT / "demo" / "server.py")
game = importlib.util.module_from_spec(spec)
spec.loader.exec_module(game)
game.LLM_MODE = "mock"
game.LLM_OPENING = False
game.DATA = WORK
# File constants are initialized on import. Redirect persistence before handling any requests.
for name, value in list(vars(game).items()):
    if isinstance(value, Path) and value.parent == ROOT / "demo" / "data":
        setattr(game, name, WORK / value.name)
game.NPC_STATE = {}
if hasattr(game, "PROGRESS"):
    game.PROGRESS = {"highest_cleared": 0}
game.tts_ready = lambda: False
game.tts_status = lambda: {"enabled": False, "ready": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), game.Handler)
    print(f"Character review: http://127.0.0.1:{args.port}/static/character-lab.html", flush=True)
    print(f"Mock game: http://127.0.0.1:{args.port}/ | saves: {WORK}", flush=True)
    server.serve_forever()
