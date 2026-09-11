import {Timeline,DURATION} from './rehearsal-timeline.mjs';
const $=id=>document.getElementById(id);let rt,last=0,raf=0,ready=false;
const timeline=new Timeline(c=>{rt.setSpeaking(!!c.speaking);rt.setEmotion(c.emotion);if(c.pose)rt.selectPose(c.pose);if(c.end)rt.endStatement();if(c.objection){rt.playObjection();$('impact').textContent='我有异议！';$('impact').classList.remove('pop');void $('impact').offsetWidth;$('impact').classList.add('pop');}else{$('impact').textContent='';$('impact').classList.remove('pop')}$('speaker').textContent=c.speaker;$('line').textContent=c.text;$('rival').classList.toggle('talking',!!c.rival);$('rival').classList.toggle('hit',!!c.hit);$('endcard').hidden=!c.endcard});
function step(now){raf=0;if(document.hidden||!timeline.running)return;timeline.advance(last?Math.min((now-last)/1000,.1):0);last=now;$('progress').textContent=`${timeline.time.toFixed(1)} / ${DURATION} 秒`;if(timeline.running)raf=requestAnimationFrame(step);else if($('loop').checked)restart();else{rt.pause(true);$('pause').textContent='继续'}}
function start(){if(!ready)return;if(timeline.time>=DURATION)return restart();timeline.start();rt.pause(false);last=0;$('pause').textContent='暂停';if(!raf&&!document.hidden)raf=requestAnimationFrame(step)}
function pause(){if(!ready)return;if(!timeline.running)return start();timeline.running=false;rt.pause(true);cancelAnimationFrame(raf);raf=0;last=0;$('pause').textContent='继续'}
function restart(){if(!ready)return;cancelAnimationFrame(raf);raf=0;rt.reset();timeline.reset();start()}
$('play').onclick=start;$('pause').onclick=pause;$('restart').onclick=restart;$('clean').onclick=()=>document.body.classList.toggle('clean');$('fullscreen').onclick=()=>{const result=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();result.catch(()=>{$('progress').textContent='全屏不可用，可手动放大窗口'})};
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;if(e.code==='Space'){e.preventDefault();pause()}if(e.key.toLowerCase()==='h')$('clean').click();if(e.key.toLowerCase()==='r')restart()});
document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);raf=0;last=0;if(!document.hidden&&timeline.running)raf=requestAnimationFrame(step)});
$('hero').addEventListener('live2d-error',()=>{timeline.running=false;cancelAnimationFrame(raf);raf=0;rt.pause(true);$('line').textContent='角色画面暂时中断，请刷新后重试。'});
async function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('角色文件读取失败'));document.head.append(s)})}
async function initialize(){try{await script('/static/vendor/live2d/5-r.5/live2dcubismcore.min.js');await script('/static/vendor/live2d/5-r.5/character-runtime.js');rt=window.Live2DCharacterRuntime;rt.mount($('hero'));await rt.loadModel('/static/assets/live2d/male-acting/male-acting.model3.json');ready=true;for(const id of ['play','pause','restart'])$(id).disabled=false;$('line').textContent='已就绪。点击“开始排练”，播放 36 秒对话演出。';rt.pause(false)}catch(e){$('line').textContent=e.message}

}initialize();

