import test from 'node:test';
import assert from 'node:assert/strict';
import { Acting } from '../src/acting.mjs';

test('objection stays in the left-arm pose until the statement ends', () => {
  const acting = new Acting();
  acting.begin();
  assert.equal(acting.update(.1).PoseLean, 1);
  assert.equal(acting.update(.05).PosePoint, 1);
  assert.equal(acting.update(120).PosePoint, 1);
  acting.begin();
  assert.equal(acting.phase, 'hold');
  acting.end();
  assert.equal(acting.update(.06).PoseLean, 1);
  assert.equal(acting.update(.07).PoseNeutral, 1);
});
test('interruptions, manual poses and reset never show two bodies', () => {
  const acting = new Acting();
  const single = () => assert.equal(Object.values(acting.update(0)).reduce((a, b) => a + b), 1);
  acting.begin(); single(); acting.end(); single(); acting.begin(); single();
  acting.select('point'); single(); assert.equal(acting.phase, 'idle');
  acting.reset(); single(); assert.equal(acting.pose, 'neutral');
  assert.throws(() => acting.select('missing'));
});
