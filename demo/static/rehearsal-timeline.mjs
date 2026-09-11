export const DURATION=36;
export const CUES=Object.freeze([
 {at:0,pose:'neutral',emotion:'calm',speaker:'王阿姨',text:'大家一直都这么说，怎么会没有道理？',rival:true},
 {at:5,pose:'neutral',emotion:'calm',speaker:'你',text:'流传得久，可以成为线索，但还不能成为结论。',speaking:true},
 {at:11,pose:'lean',emotion:'tense',speaker:'你',text:'我们先看证据：这个说法，究竟解释了什么？',speaking:true},
 {at:16,objection:true,emotion:'tense',speaker:'你',text:'我有异议！“大家相信”并不能推出“它是真的”。',speaking:true},
 {at:23,end:true,emotion:'calm',speaker:'王阿姨',text:'……那你说，应该怎样判断？',rival:true,hit:true},
 {at:28,pose:'neutral',emotion:'calm',speaker:'你',text:'把事实、推测和结论分开，再逐项核对。',speaking:true},
 {at:34,pose:'neutral',emotion:'calm',speaker:'演出结束',text:'',endcard:true},
]);
export class Timeline{
 constructor(apply){this.apply=apply;this.reset()}
 reset(){this.time=0;this.index=-1;this.running=false}
 start(){this.running=true;this.advance(0)}
 advance(dt){if(!this.running)return;this.time=Math.min(DURATION,this.time+Math.max(0,Number.isFinite(dt)?dt:0));while(this.index+1<CUES.length&&CUES[this.index+1].at<=this.time)this.apply(CUES[++this.index]);if(this.time>=DURATION)this.running=false}
}
