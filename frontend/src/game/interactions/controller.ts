import { $, notice, log } from '../../ui/dom';
import type { GameScene } from '../rendering/scene';
import type { Network } from '../../network/api';
import { requestId } from '../../network/api';
import type { Session } from './session';
import type { Agent } from '../entities/types';
import type { Envelope } from '../../network/protocol';
export function bindInteractions(game: GameScene, network: Network, session: Session, keys: Set<string>, isPreview: () => boolean) {
    let selectedAgent: string | undefined, lastInteraction: {requestId:string;objectId:string} | undefined;
    function renderQuestion() {
        const question = session.question?.npcId === selectedAgent ? session.question : undefined;
        const pending = !!question?.pending;
        const status = $('assistant-status');
        status.textContent = pending ? 'Инструктор готовит ответ…' : question?.error ?? '';
        status.hidden = !status.textContent;
        $<HTMLButtonElement>('repeat').disabled = pending;
        $<HTMLFormElement>('ask').querySelector<HTMLButtonElement>('button')!.disabled = pending;
        $<HTMLFormElement>('ask').querySelector<HTMLInputElement>('input')!.disabled = pending;
    }
    session.addEventListener('change', renderQuestion);
    function openTalk(npcId: string) {
        lastInteraction = undefined;
        if (selectedAgent !== npcId) {
            if (selectedAgent) session.dismiss(selectedAgent);
            $('messages').replaceChildren();
        }
        selectedAgent = npcId;
        $('talk').hidden = false;
        keys.clear();
        renderQuestion();
    }
    session.addEventListener('reply', e => {
        const p = (e as CustomEvent).detail;
        // Session validates request/task/revision before this event reaches the view.
        if (selectedAgent !== p.npcId)
            return;
        openTalk(p.npcId);
        $('sign-name').textContent = 'ИИ Инструктор';
        log('messages', p.text);
        if (p.visualHints.length)
            game.applyHints(p.visualHints);
    });
    function closeTalk() {
        if (selectedAgent)
            session.dismiss(selectedAgent);
        selectedAgent = undefined;
        lastInteraction = undefined;
        $('talk').hidden = true;
        game.clearHints();
        keys.clear();
        renderQuestion();
    }
    $('close-talk').onclick = closeTalk;
    function chooseAction(action:string){
        if(!session.motion)return false;
        if(session.motion.phase==='question')session.answer(action);
        else if(session.motion.phase==='awaiting_direction')session.maneuver(action);
        keys.clear();return true;
    }
    function ask(text: string): boolean {
        if (!selectedAgent)
            return false;
        if (isPreview()) {
            log('messages', 'Тест сцены: LLM и память доступны только с настоящим сервером.');
            return true;
        }
        if (session.ask(selectedAgent, text)) {
            log('messages', `Вы: ${text}`);
            return true;
        }
        return false;
    }
    $('ask').addEventListener('submit', e => {
        e.preventDefault();
        const form = $<HTMLFormElement>('ask');
        const text = String(new FormData(form).get('question')).trim();
        if (text && ask(text)) {
            form.reset();
        }
    });
    $('repeat').onclick = () => ask('Объясни другим примером и подсвети важные объекты');
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-role]'))
        button.onclick = () => network.send('episode_join', { scenarioId: 'shared-priority', role: button.dataset.role }, requestId());
    $('episode-ready').onclick = () => {
        if (session.episode)
            network.send('episode_ready', { episodeId: session.episode.episodeId, sceneRevision: session.episode.sceneRevision }, requestId());
    };
    $('episode-leave').onclick = () => {
        if (session.episode)
            network.send('episode_leave', { episodeId: session.episode.episodeId }, requestId());
    };
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lesson]'))
        button.onclick = () => network.send('lesson_start', { lessonId: button.dataset.lesson }, requestId());
    function interact(agent?: Agent) {
        if (!network.ready && !isPreview())
            return;
        if (!agent)
            agent = game.nearestAgent();
        if (!agent)
            return;
        if (Math.abs(game.ownVehicle?.speed ?? 0) > .3) {
            notice('Остановитесь перед разговором с инструктором.');
            return;
        }
        openTalk(agent.id);
        $('sign-name').textContent = 'ИИ Инструктор';
        if (isPreview()) {
            log('messages', 'Это тест геометрии знака. Ответы и память появятся после подключения сервера.');
            return;
        }
        lastInteraction = {requestId:requestId(),objectId:agent.id};
        network.send('interact', { objectId: agent.id }, lastInteraction.requestId);
    }
    window.addEventListener('game:command', e => {
        const { type, payload, requestId: id } = (e as CustomEvent).detail;
        if (type === 'answer_submit') {
            if (payload.taskId === session.task?.taskId && payload.sceneRevision === session.task?.sceneRevision)
                session.answer(payload.answerId, id);
            else
                notice('Карточка устарела');
            return;
        }
        if (type === 'npc_message') {
            openTalk(payload.npcId);
            session.ask(payload.npcId, payload.text, id);
            return;
        }
        network.send(type, payload, id);
    });
    function consume(message: Envelope) {
        const m = message, p = m.payload;
        const activeTask = session.task;
        const accepted = session.consume(m);
        if (accepted && (m.type === 'task_started' || m.type === 'world_joined')) {
            closeTalk();
            $('messages').replaceChildren();
            game.clearHints();
            $('exercise').hidden = !session.task && !session.episode;
            if(session.motion&&session.task){$('exercise').hidden=true;openTalk(session.task.helperNpcId);$('sign-name').textContent='ИИ Инструктор';log('messages',session.task.prompt);}
        }
        if(accepted&&m.type==='trip_state'){
            $('exercise').hidden=true;
            if(p.phase==='awaiting_direction'){openTalk(session.task?.helperNpcId??p.helperNpcId);log('messages',p.status);}
            if(p.phase==='question'&&session.task&&$('talk').hidden){openTalk(session.task.helperNpcId);$('sign-name').textContent='ИИ Инструктор';log('messages',session.task.prompt);}
        }
        if (accepted && m.type === 'answer_result' && activeTask) {
            openTalk(activeTask.helperNpcId);
            if (p.explanation) log('messages',p.explanation);
        }
        if (accepted && m.type === 'episode_state')
            $('exercise').hidden = false;
        if (m.type === 'interaction_result' && lastInteraction && m.requestId === lastInteraction.requestId && p.objectId === lastInteraction.objectId) {
            lastInteraction = undefined;
            $('sign-name').textContent = 'ИИ Инструктор';
            log('messages', p.text);
            if (p.npcId)
                selectedAgent = p.npcId;
        }
        if (accepted && m.type === 'episode_state' && ['completed', 'cancelled'].includes(p.phase) && (!activeTask || activeTask.episodeId === p.episodeId)) {
            closeTalk();
            game.clearHints();
        }
    }
    function clear() {
        closeTalk();
        $('messages').replaceChildren();
        $('sign-name').textContent = 'ИИ Инструктор';
    }
    return { interact, closeTalk, consume, clear,chooseAction };
}
