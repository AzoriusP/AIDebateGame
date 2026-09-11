"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const stateNames = {calm:"冷静",anxious:"焦虑",tense:"紧张",desperate:"绝望",smug:"得意",shaken:"动摇",defeated:"被说服"};
  let emotion = "calm", paused = false;
  const controller = DebateCharacters.create($("preview"), {characterId:"player", onDegraded: degraded => {
    $("asset-status").textContent = $("preview").dataset.assetStatus === "missing"
      ? "角色图片加载失败，当前无可显示的立绘。"
      : degraded ? "目标表情未提供或加载失败，正在显示该角色的备用立绘。" : "正在显示已存在的表情立绘。";
  }});
  const driver = controller.performance;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  function applyMotion() {
    controller.setMotionEnabled($("motion").checked && !reduced.matches);
    if(reduced.matches) $("events").textContent="系统已开启减少动态效果，动画参数保持静止。";
  }
  reduced.addEventListener("change", applyMotion);
  $("motion").addEventListener("change", applyMotion);
  applyMotion();
  const defs = [["breath","呼吸",0,1],["eyeOpen","睁眼",0,1],["mouthOpen","口型",0,1],["bodyAngle","姿态",-10,10],["objection","指向参数",0,1]];
  for(const [id,label,min,max] of defs){
    const row=document.createElement("div");row.className="meter";
    const name=document.createElement("span");name.textContent=label;
    const meter=document.createElement("meter");meter.id=`meter-${id}`;meter.min=min;meter.max=max;meter.value=0;meter.setAttribute("aria-label",label);
    const out=document.createElement("output");out.id=`value-${id}`;
    row.append(name,meter,out);$("meters").append(row);
  }
  function renderEmotions(){
    $("emotions").replaceChildren();
    const names=$("character").value==="player"?["calm","tense","anxious","desperate"]:["calm","smug","shaken","defeated"];
    for(const name of names){const button=document.createElement("button");button.textContent=stateNames[name];button.setAttribute("aria-pressed",String(emotion===name));button.addEventListener("click",()=>{emotion=name;controller.setEmotion(name);renderEmotions();});$("emotions").append(button);}
  }
  try {
    const data=await DebateCharacters.manifest();
    for(const [id,asset] of Object.entries(data.characters)){const option=document.createElement("option");option.value=id;option.textContent=asset.label;$("character").append(option);}
    $("character").value="player";
    renderEmotions();
  }catch(error){$("asset-status").textContent=error.message;}
  $("character").addEventListener("change",()=>{emotion="calm";controller.setCharacter($("character").value);$("speaking").checked=false;renderEmotions();});
  $("speaking").addEventListener("change",()=>controller.setSpeaking($("speaking").checked));
  $("objection").addEventListener("click",()=>{controller.playObjection({durationMs:1000});$("events").textContent=driver.motionEnabled&&!paused?"收到异议事件：指向参数上升 → 保持 → 回到待机。当前素材无手臂模型，未播放指向画面。":"动画已关闭或暂停，异议动作不启动。";});
  $("pause").addEventListener("click",()=>{paused=!paused;controller.pause(paused);$("pause").textContent=paused?"继续":"暂停";$("pause").setAttribute("aria-pressed",String(paused));});
  $("reset").addEventListener("click",()=>{emotion="calm";paused=false;controller.pause(false);controller.reset();$("pause").textContent="暂停";$("pause").setAttribute("aria-pressed","false");$("speaking").checked=false;renderEmotions();$("events").textContent="角色状态与动作已重置。";});
  let previous=performance.now(),frame;
  /* 参数由 characters.js 的立绘演出循环推进（避免两条 rAF 同时 update 同一个参数集），这里只读回展示。 */
  function tick(now){const values=driver.values;previous=now;for(const[id]of defs){$("meter-"+id).value=values[id];$("value-"+id).textContent=values[id].toFixed(2);}frame=requestAnimationFrame(tick);}
  frame=requestAnimationFrame(tick);
  document.addEventListener("visibilitychange",()=>{cancelAnimationFrame(frame);if(!document.hidden){previous=performance.now();frame=requestAnimationFrame(tick);}});
  window.addEventListener("pagehide",event=>{cancelAnimationFrame(frame);if(!event.persisted)controller.destroy();});
  window.addEventListener("pageshow",event=>{if(event.persisted){cancelAnimationFrame(frame);previous=performance.now();frame=requestAnimationFrame(tick);}});
})();
