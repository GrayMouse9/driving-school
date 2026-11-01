import type {Envelope} from '../../network/protocol';
import type {TaskStarted,EpisodeState,Progress} from '../../network/protocol';
import {requestId} from '../../network/api';
type Send=(type:string,payload:unknown,id?:string)=>boolean;
export class Session extends EventTarget {
 task?:TaskStarted;episode?:EpisodeState;progress?:Progress;result?:any;
 private pendingAnswer?:{id:string;taskId:string;revision:number};
 private pending=new Map<string,{npcId:string;taskId?:string;revision?:number}>();private explained=new Set<string>();
 constructor(private send:Send){super();}
 get answerPending(){return !!this.pendingAnswer;}
 get blocked(){return this.task?.kind==='choice'||(!!this.episode&&(!this.task||this.task.episodeId===this.episode.episodeId)&&['answering','paused'].includes(this.episode.phase));}
 clear(){this.task=undefined;this.episode=undefined;this.result=undefined;this.progress=undefined;this.pending.clear();this.pendingAnswer=undefined;this.explained.clear();this.dispatchEvent(new Event('change'));}
 answer(answerId:string,id=requestId()){const task=this.task;if(!task||task.kind!=='choice'||this.pendingAnswer||this.result?.correct)return false;
  this.pendingAnswer={id,taskId:task.taskId,revision:task.sceneRevision};
  const ok=this.send('answer_submit',{taskId:task.taskId,answerId,sceneRevision:task.sceneRevision},id);if(!ok)this.pendingAnswer=undefined;
  this.dispatchEvent(new Event('change'));return ok;
 }
 dismiss(npcId:string){for(const [id,context]of this.pending)if(context.npcId===npcId)this.pending.delete(id);}
 ask(npcId:string,text:string,id=requestId()){const context={npcId,taskId:this.task?.taskId,revision:this.task?.sceneRevision};
  this.pending.set(id,context);while(this.pending.size>32)this.pending.delete(this.pending.keys().next().value!);
  if(!this.send('npc_message',{npcId,text,...(context.taskId?{taskId:context.taskId,sceneRevision:context.revision}:{})},id)){this.pending.delete(id);return undefined;}
  return id;
 }
 consume(message:Envelope){const p=message.payload;
  switch(message.type){
   case 'world_joined':this.clear();this.task=p.activeTask??undefined;this.episode=p.episode??undefined;this.progress=p.progress;break;
   case 'task_started':if(!p.taskId||!Array.isArray(p.options))return false;this.task=p;this.pendingAnswer=undefined;this.result=undefined;break;
   case 'episode_state':this.episode=p;if(['completed','cancelled'].includes(p.phase)){if(this.task?.episodeId===p.episodeId){this.task=undefined;this.pendingAnswer=undefined;}}break;
   case 'progress_updated':this.progress=p.progress;break;
   case 'answer_result':{
    if(p.taskId!==this.task?.taskId)return false;
    if(p.stage==='choice'){if(!this.pendingAnswer||message.requestId!==this.pendingAnswer.id)return false;this.pendingAnswer=undefined;}
    this.result=p;
    const key=message.requestId??`${p.taskId}:${p.stage}`;
    if(!p.correct&&!this.explained.has(key)){
     this.explained.add(key);while(this.explained.size>64)this.explained.delete(this.explained.values().next().value!);
     this.ask(this.task!.helperNpcId,'Объясни мою последнюю ошибку');
    }
    break;
   }
   case 'npc_reply':{
    const context=message.requestId?this.pending.get(message.requestId):undefined;if(!context||context.npcId!==p.npcId)return false;
    this.pending.delete(message.requestId!);
    const current=context.taskId===this.task?.taskId&&context.revision===this.task?.sceneRevision&&p.taskId===(context.taskId??null)&&p.sceneRevision===(context.revision??null);
    this.dispatchEvent(new CustomEvent('reply',{detail:{...p,visualHints:current?(p.visualHints??[]):[],requestId:message.requestId}}));return true;
   }
   case 'server_error':if(message.requestId)this.pending.delete(message.requestId);if(message.requestId===this.pendingAnswer?.id){this.pendingAnswer=undefined;this.dispatchEvent(new Event('change'));}return false;
   default:return false;
  }
  this.dispatchEvent(new Event('change'));return true;
 }
}
