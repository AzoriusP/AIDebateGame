const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Performance, normalizeEmotion } = require('../static/character-performance.js');
const advance = (driver, seconds) => { let v; for (let i=0;i<Math.ceil(seconds*60);i++) v=driver.update(1/60);return v; };

test('Chinese game states and NPC outcomes normalize explicitly', () => {
  for(const [label,state] of Object.entries({'从容':'calm','冷静':'calm','焦虑':'anxious','紧张':'tense','绝望':'desperate','得意':'smug','动摇':'shaken','被说服':'defeated'})) assert.equal(normalizeEmotion(label),state);
  assert.equal(normalizeEmotion('missing'), 'calm');
});
test('all emotional profiles breathe and blink in range over time', () => {
  const means=[];
  for(const emotion of ['calm','tense','anxious','desperate']){
    const driver=new Performance({seed:3});driver.setEmotion(emotion);
    let maxBreath=0,closed=false;
    for(let i=0;i<1800;i++){
      const p=driver.update(1/60);maxBreath=Math.max(maxBreath,p.breath);closed ||= p.eyeOpen<0.1;
      for(const id of ['breath','eyeOpen','mouthOpen','objection']) assert.ok(p[id]>=0 && p[id]<=1,`${emotion}/${id}`);
    }
    assert.ok(closed,emotion+' must close its eyes');means.push(maxBreath);
  }
  assert.ok(means[0]<means[1] && means[1]<means[2] && means[2]<means[3]);
});
test('facial forms follow the current emotion independently of speaking and elapsed time',()=>{
  const driver=new Performance({seed:17});
  for(const [emotion,brow,mouth] of [['calm',0,0],['anxious',-0.4,-0.3],['tense',0.8,0.3],['desperate',-1,-0.8],['冷静',0,0],['动摇',0.8,0.3],['被说服',-1,-0.8],['得意',0,0]]){
    driver.setEmotion(emotion);
    for(const speaking of [false,true]){
      driver.setSpeaking(speaking);
      for(const dt of [0,1/60,0.1]){
        const value=driver.update(dt);
        assert.deepEqual([value.browForm,value.mouthForm],[brow,mouth],emotion);
      }
    }
  }
});
test('facial forms freeze when paused, clear when disabled, and resume from the current state',()=>{
  const driver=new Performance();driver.setEmotion('tense');driver.update(0);driver.pause(true);driver.setEmotion('desperate');
  assert.deepEqual([driver.update(1).browForm,driver.values.mouthForm],[0.8,0.3]);
  driver.setMotionEnabled(false);
  assert.deepEqual([driver.update(1).browForm,driver.values.mouthForm],[0,0]);
  driver.pause(false);driver.setEmotion('anxious');
  assert.deepEqual([driver.update(1).browForm,driver.values.mouthForm],[0,0]);
  driver.setMotionEnabled(true);
  assert.deepEqual([driver.update(0).browForm,driver.values.mouthForm],[-0.4,-0.3]);
  driver.reset();
  assert.deepEqual([driver.values.browForm,driver.values.mouthForm],[0,0]);
});
test('objection restarts, finishes and returns to current emotion',()=>{
  const driver=new Performance();driver.setEmotion('anxious');driver.playObjection({durationMs:1000});
  assert.ok(advance(driver,0.35).objection>0.99);
  driver.playObjection({durationMs:1000});assert.ok(driver.update(1/60).objection<0.4);
  assert.equal(advance(driver,1.2).objection,0);assert.equal(driver.emotion,'anxious');
});
test('pause freezes time; disabled motion cancels an action even while paused',()=>{
  const driver=new Performance();driver.playObjection();advance(driver,0.3);driver.pause(true);
  const frozen={...driver.values};assert.deepEqual(advance(driver,4),frozen);
  driver.setMotionEnabled(false);assert.equal(driver.update(0.1).objection,0);assert.equal(driver.playObjection(),false);
  driver.pause(false);assert.equal(advance(driver,1).mouthOpen,0);
});
test('reset clears transient speaking and objection state',()=>{
  const driver=new Performance();driver.setSpeaking(true);driver.setEmotion('desperate');driver.playObjection();advance(driver,0.5);driver.reset();
  assert.equal(driver.speaking,false);assert.equal(driver.action,null);assert.equal(driver.emotion,'calm');
});

function makeHarness(data) {
  const pending=new Map(),requests=[],events=[];
  const element=()=>({className:'',dataset:{},hidden:false,src:'',classList:{add(){}},replaceChildren(...children){this.children=children;},removeAttribute(name){delete this[name];},dispatchEvent(event){events.push(event);}});
  class FakeImage {
    set src(url){requests.push(url);if(!pending.has(url))pending.set(url,[]);pending.get(url).push(this);}
  }
  const context={window:{DebatePerformance:require('../static/character-performance.js')},fetch:async()=>({ok:true,json:async()=>data}),Image:FakeImage,document:{createElement:element},CustomEvent:class {constructor(type,init){this.type=type;this.detail=init.detail;}},setTimeout,clearTimeout,console:{warn(){}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/characters.js'),'utf8'),context);
  return {api:context.window.DebateCharacters,host:element(),requests,events,finish(url,ok=true){const list=pending.get(url)||[];pending.delete(url);for(const im of list){const fn=ok?im.onload:im.onerror;if(fn)fn();}}};
}
const fixture={version:1,characters:{player:{label:'Player',portraits:{calm:'/calm',anxious:'/anxious',tense:'/tense'},fallback:'/fallback'},L1_A:{label:'NPC',portraits:{calm:'/npc'}}}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('late calm load cannot overwrite a newer tense expression',async()=>{
  const h=makeHarness(fixture),c=h.api.create(h.host);await flush();c.setEmotion('tense');await flush();
  h.finish('/tense');await c.ready;h.finish('/calm');await flush();
  assert.equal(c.img.src,'/tense');assert.equal(h.host.dataset.emotion,'tense');c.destroy();
});
test('changing character invalidates all earlier image loads',async()=>{
  const h=makeHarness(fixture),c=h.api.create(h.host);await flush();c.setCharacter('L1_A');await flush();h.finish('/npc');await c.ready;
  h.finish('/calm');await flush();assert.equal(c.img.src,'/npc');assert.equal(h.host.dataset.characterId,'L1_A');c.destroy();
});
test('missing NPC expressions only request registered calm fallback',async()=>{
  const h=makeHarness(fixture);let degraded;
  const c=h.api.create(h.host,{characterId:'L1_A',onDegraded:value=>degraded=value});c.setEmotion('被说服');await flush();h.finish('/npc');await c.ready;
  assert.equal(degraded,true);assert.deepEqual(h.requests,['/npc']);assert.equal(h.host.dataset.emotion,'defeated');c.destroy();
});
test('failed image uses fallback and can be retried after transient failure',async()=>{
  const h=makeHarness(fixture),c=h.api.create(h.host);await flush();h.finish('/calm',false);await flush();h.finish('/fallback');await c.ready;
  assert.equal(c.img.src,'/fallback');c.setEmotion('calm');await flush();h.finish('/calm');await c.ready;assert.equal(c.img.src,'/calm');c.destroy();
});
test('destroyed character ignores pending loads without reattaching artwork',async()=>{
  const h=makeHarness(fixture),c=h.api.create(h.host);await flush();c.destroy();h.finish('/calm');await c.ready;
  assert.equal(h.host.children.length,0);assert.equal(c.img.src,'');
});
