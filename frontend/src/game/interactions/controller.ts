import { $, notice, log } from '../../ui/dom';
import type { GameScene } from '../rendering/scene';
import type { Network } from '../../network/api';
import { requestId } from '../../network/api';
import type { Session } from './session';
import type { Agent } from '../entities/types';
import type { Envelope } from '../../network/protocol';
export function bindInteractions(game: GameScene, network: Network, session: Session, keys: Set<string>, isPreview: () => boolean) {
    let selectedAgent: string | undefined, lastInteraction: string | undefined;
    function openTalk(npcId: string) {
        if (selectedAgent !== npcId)
            $('messages').replaceChildren();
        selectedAgent = npcId;
        $('talk').hidden = false;
        keys.clear();
    }
    session.addEventListener('reply', e => {
        const p = (e as CustomEvent).detail;
        // A late answer can remain in history, but cannot replace another sign's dialog.
        if (selectedAgent !== p.npcId)
            return;
        openTalk(p.npcId);
        $('sign-name').textContent = p.name;
        log('messages', p.text);
        if (p.visualHints.length)
            game.applyHints(p.visualHints);
    });
    function closeTalk() {
        if (selectedAgent)
            session.dismiss(selectedAgent);
        selectedAgent = undefined;
        $('talk').hidden = true;
        keys.clear();
    }
    $('close-talk').onclick = closeTalk;
    function ask(text: string) {
        if (!selectedAgent)
            return;
        if (isPreview()) {
            log('messages', 'Тест сцены: LLM и память доступны только с настоящим сервером.');
            return;
        }
        if (session.ask(selectedAgent, text))
            log('messages', `Вы: ${text}`);
    }
    $('ask').addEventListener('submit', e => {
        e.preventDefault();
        const form = $<HTMLFormElement>('ask');
        const text = String(new FormData(form).get('question')).trim();
        if (text) {
            ask(text);
            form.reset();
        }
    });
    $('repeat').onclick = () => ask('Объясни другим примером и подсвети важные объекты');
    $('task-helper').onclick = () => {
        if (session.task) {
            openTalk(session.task.helperNpcId);
            ask('Объясни условия моего задания');
        }
    };
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
            notice('Остановитесь перед разговором со знаком.');
            return;
        }
        openTalk(agent.id);
        $('sign-name').textContent = 'Знак-помощник';
        if (isPreview()) {
            log('messages', 'Это тест геометрии знака. Ответы и память появятся после подключения сервера.');
            return;
        }
        lastInteraction = requestId();
        network.send('interact', { objectId: agent.id }, lastInteraction);
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
        if (m.type === 'task_started') {
            game.clearHints();
            $('exercise').hidden = false;
        }
        const activeTask = session.task;
        if (m.type === 'answer_result' && !p.correct && activeTask && activeTask.taskId === p.taskId)
            openTalk(activeTask.helperNpcId);
        session.consume(m);
        if (m.type === 'episode_state')
            $('exercise').hidden = false;
        if (m.type === 'interaction_result' && m.requestId === lastInteraction) {
            $('sign-name').textContent = p.name;
            log('messages', p.text);
            if (p.npcId)
                selectedAgent = p.npcId;
        }
        if (m.type === 'episode_state' && ['completed', 'cancelled'].includes(p.phase)) {
            closeTalk();
            game.clearHints();
        }
    }
    function clear() {
        selectedAgent = undefined;
        lastInteraction = undefined;
        $('talk').hidden = true;
    }
    return { interact, closeTalk, consume, clear };
}
