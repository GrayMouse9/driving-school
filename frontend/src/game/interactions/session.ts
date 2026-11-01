import type {Envelope} from '../../network/protocol';
import type {TaskStarted,EpisodeState,Progress} from '../../network/protocol';
import {requestId} from '../../network/api';
type Send=(type:string,payload:unknown,id?:string)=>boolean;
export class Session extends EventTarget {
 task?:TaskStarted;episode?:EpisodeState;progress?:Progress;result?:any;
 question?:{npcId:string;requestId:string;pending:boolean;error?:string};
 motion?:{helperNpcId?:string;taskId?:string;phase:string;locationId:string;sceneRevision:number;allowedActions:string[];status:string};
 private pendingManeuver?:string;
 private pendingAnswer?:{id:string;taskId:string;revision:number};
 private pending=new Map<string,{npcId:string;taskId?:string;revision?:number}>();private explained=new Set<string>();
 constructor(private send:Send){super();}
 get answerPending(){return !!this.pendingAnswer;}
 get maneuverPending(){return !!this.pendingManeuver;}
 maneuver(action:string,id=requestId()){
  const motion=this.motion;if(!motion||motion.phase!=='awaiting_direction'||!motion.allowedActions.includes(action)||this.pendingManeuver)return false;
  this.pendingManeuver=id;const ok=this.send('maneuver_choose',{locationId:motion.locationId,sceneRevision:motion.sceneRevision,action},id);if(!ok)this.pendingManeuver=undefined;this.dispatchEvent(new Event('change'));return ok;
 }
 get blocked(){return this.task?.kind==='choice'||(!!this.episode&&(!this.task||this.task.episodeId===this.episode.episodeId)&&['answering','paused'].includes(this.episode.phase));}
 clear(){this.motion=undefined;this.pendingManeuver=undefined;this.task=undefined;this.episode=undefined;this.result=undefined;this.progress=undefined;this.question=undefined;this.pending.clear();this.pendingAnswer=undefined;this.explained.clear();this.dispatchEvent(new Event('change'));}
 answer(answerId:string,id=requestId()){const task=this.task;if(!task||task.kind!=='choice'||this.pendingAnswer||this.result?.correct||!task.options.some(option=>option.id===answerId))return false;
  this.pendingAnswer={id,taskId:task.taskId,revision:task.sceneRevision};
  const ok=this.send('answer_submit',{taskId:task.taskId,answerId,sceneRevision:task.sceneRevision},id);if(!ok)this.pendingAnswer=undefined;
  this.dispatchEvent(new Event('change'));return ok;
 }
 dismiss(npcId:string){for(const [id,context]of this.pending)if(context.npcId===npcId)this.pending.delete(id);if(this.question?.npcId===npcId){this.question=undefined;this.dispatchEvent(new Event('change'));}}
 ask(npcId:string,text:string,id=requestId(),purpose?:'answer_feedback'){
  if(this.question?.npcId===npcId&&this.question.pending)return undefined;
  const context={npcId,taskId:this.task?.taskId??this.motion?.taskId,revision:this.task?.sceneRevision??this.motion?.sceneRevision};
  this.question={npcId,requestId:id,pending:true};
  this.pending.set(id,context);while(this.pending.size>32)this.pending.delete(this.pending.keys().next().value!);
  if(!this.send('npc_message',{npcId,text,...(purpose?{purpose}:{}),...(context.taskId?{taskId:context.taskId,sceneRevision:context.revision}:{})},id)){
   this.pending.delete(id);this.question={npcId,requestId:id,pending:false,error:'Нет связи с сервером. Подключитесь и повторите вопрос.'};this.dispatchEvent(new Event('change'));return undefined;
  }
  this.dispatchEvent(new Event('change'));
  return id;
 }
 consume(message:Envelope){const p=message.payload;
  switch(message.type){
   case 'trip_state':this.motion=p;this.pendingManeuver=undefined;if(p.phase==='driving'||p.phase==='completed'){this.pendingAnswer=undefined;}break;
   case 'world_joined':this.clear();this.task=p.activeTask??undefined;this.episode=p.episode??undefined;this.progress=p.progress;break;
   case 'task_started':{
    if(!p.taskId||!Array.isArray(p.options)||!Number.isSafeInteger(p.sceneRevision)||p.sceneRevision<0)return false;
    if(this.task&&this.task.taskId===p.taskId&&(p.sceneRevision<this.task.sceneRevision||(p.sceneRevision===this.task.sceneRevision&&p.kind===this.task.kind)))return false;
    this.task=p;this.pendingAnswer=undefined;this.result=undefined;this.question=undefined;this.pending.clear();break;
   }
   case 'episode_state':this.episode=p;if(['completed','cancelled'].includes(p.phase)){if(this.task?.episodeId===p.episodeId){this.task=undefined;this.pendingAnswer=undefined;this.question=undefined;this.pending.clear();}}break;
   case 'progress_updated':this.progress=p.progress;break;
   case 'answer_result':{
    if(!this.task||p.taskId!==this.task.taskId||p.stage!==this.task.kind)return false;
    if(p.stage==='choice'){if(!this.pendingAnswer||message.requestId!==this.pendingAnswer.id||this.pendingAnswer.taskId!==this.task.taskId||this.pendingAnswer.revision!==this.task.sceneRevision)return false;this.pendingAnswer=undefined;}
    this.result=p;
    const key=message.requestId??`${p.taskId}:${p.stage}`;
    if(!this.explained.has(key)){
     this.explained.add(key);while(this.explained.size>64)this.explained.delete(this.explained.values().next().value!);
     this.dismiss(this.task.helperNpcId);
     this.ask(this.task!.helperNpcId,p.correct?'Объясни мой последний ответ':'Объясни мою последнюю ошибку',requestId(),'answer_feedback');
    }
    break;
   }
   case 'npc_reply':{
    const context=message.requestId?this.pending.get(message.requestId):undefined;if(!context||context.npcId!==p.npcId)return false;
    this.pending.delete(message.requestId!);
    const current=context.taskId===(this.task?.taskId??this.motion?.taskId)&&context.revision===(this.task?.sceneRevision??this.motion?.sceneRevision)&&p.taskId===(context.taskId??null)&&p.sceneRevision===(context.revision??null);
    if(this.question&&this.question.requestId===message.requestId){this.question={...this.question,pending:false,...(!current?{error:'Ответ относится к другой ситуации. Повторите вопрос.'}:{})};this.dispatchEvent(new Event('change'));}
    if(!current)return false;
    this.dispatchEvent(new CustomEvent('reply',{detail:{...p,visualHints:p.visualHints??[],requestId:message.requestId}}));return true;
   }
   case 'server_error':{
    if(message.requestId===this.pendingManeuver)this.pendingManeuver=undefined;
    if(message.requestId)this.pending.delete(message.requestId);
    let changed=false;
    if(message.requestId&&message.requestId===this.question?.requestId&&this.question.pending){this.question={...this.question,pending:false,error:typeof p.message==='string'?p.message:'Помощник временно недоступен. Повторите вопрос.'};changed=true;}
    if(this.pendingAnswer&&message.requestId===this.pendingAnswer.id){this.pendingAnswer=undefined;changed=true;}
    if(changed)this.dispatchEvent(new Event('change'));return false;
   }
   default:return false;
  }
  this.dispatchEvent(new Event('change'));return true;
 }
}
