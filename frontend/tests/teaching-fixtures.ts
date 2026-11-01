import type {Chunk} from '../src/game/world/types';
import type {TaskStarted} from '../src/network/protocol';
import type {Vec3} from '../src/game/entities/types';

// Geometry comes from the real generated server world. Only the teaching messages
// are fixtures, until the backend provides lesson launch and grading.
export function personalSceneFixture(kind:'crosswalk'|'stop',chunks:Chunk[]):{
 chunk:Chunk; spawn:Vec3 & {yaw:number}; task:TaskStarted;
}{
 const chunk=chunks.find(c=>c.id===(kind==='crosswalk'?'c_-1_0':'c_1_0'));
 if(!chunk)throw new Error(`Missing actual ${kind} intersection`);
 const approach=chunk.teaching?.paths.find(p=>p.id===(kind==='crosswalk'?'pedestrians-p-right':'stop-k-approach'));
 if(!approach)throw new Error(`Missing actual ${kind} approach`);
 const [first,next]=approach.points;
 const spawn={...first,yaw:Math.atan2(first.x-next.x,first.z-next.z)};
 const common={kind:'choice' as const,episodeId:null,sceneRevision:1};
 if(kind==='crosswalk')return {chunk,spawn,task:{...common,
  lessonId:'green-turn-pedestrians-p',taskId:'fixture-pedestrians',scenarioId:'green-turn-pedestrians-p',role:'P',
  title:'Зелёный сигнал и пешеходы',prompt:'Как действовать при повороте направо?',
  sourceLabel:'На основе билета №37, вопроса №13',helperNpcId:'pedestrians-crosswalk-sign',
  options:[{id:'a1',text:'Дождаться прохода пешеходов перед стоп-линией'},{id:'a2',text:'Въехать на перекрёсток и уступить перед переходом'},{id:'a3',text:'Выполнить поворот, не останавливаясь'}],
 }};
 return {chunk,spawn,task:{...common,
  lessonId:'stop-no-line-k',taskId:'fixture-stop',scenarioId:'stop-no-line-k',role:'K',
  title:'STOP без стоп-линии',prompt:'Где Вы должны остановиться?',sourceLabel:'На основе билета №3, вопроса №2',helperNpcId:'stop-no-line-sign',
  options:[{id:'a1',text:'Перед знаком — А'},{id:'a2',text:'Перед перекрёстком — Б'},{id:'a3',text:'Перед краем пересекаемой проезжей части — В'}],
 }};
}
