import test from 'node:test';import assert from 'node:assert/strict';
import {Timeline,CUES,DURATION} from '../../../demo/static/rehearsal-timeline.mjs';
import {Acting} from '../src/acting.mjs';
test('rehearsal holds objection until reply, finishes and repeats without stale cues',()=>{
 const seen=[],acting=new Acting();const t=new Timeline(c=>{seen.push(c.at);if(c.pose)acting.select(c.pose);if(c.objection)acting.begin();if(c.end)acting.end()});
 t.start();for(let i=0;i<220;i++){t.advance(.1);acting.update(.1)}assert.equal(acting.pose,'point');
 const frozen=t.time;t.running=false;t.advance(10);assert.equal(t.time,frozen);t.start();
 for(let i=0;i<150;i++){t.advance(.1);acting.update(.1)}assert.equal(t.time,DURATION);assert.equal(t.running,false);assert.equal(acting.pose,'neutral');assert.deepEqual(seen,CUES.map(c=>c.at));
 t.reset();acting.reset();t.start();assert.equal(t.index,0);assert.equal(seen.at(-1),0);
});
