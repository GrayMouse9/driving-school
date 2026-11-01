import { $ } from './dom';
import type { Session } from '../game/interactions/session';
export function bindTaskView(session: Session, keys: Set<string>) {
    function renderTask() {
        const actions = $('instructor-actions');
        actions.replaceChildren();
        const phase = session.motion?.phase;
        const waiting = phase === 'awaiting_direction';
        const task = !phase || phase === 'question' ? session.task : undefined;
        if (waiting) {
            const labels: Record<string, string> = {left:'A / ← — налево',forward:'W / ↑ — прямо',right:'D / → — направо'};
            for (const action of session.motion!.allowedActions) {
                const button = document.createElement('button');
                button.textContent = labels[action] ?? action;
                button.disabled = session.maneuverPending;
                button.onclick = () => session.maneuver(action);
                actions.append(button);
            }
        } else if (task?.kind === 'choice') {
            for (const option of task.options) {
                const button = document.createElement('button');
                button.textContent = option.text;
                button.disabled = session.answerPending || !!session.result?.correct;
                button.onclick = () => session.answer(option.id);
                actions.append(button);
            }
        }
        actions.hidden = !actions.childElementCount;
        const episode = session.episode;
        $('episode-status').textContent = episode ? `Роль ${episode.selfRole ?? '—'} · ${episode.phase}${episode.selfAnswerCorrect ? ' · ответ принят' : ''}` : 'Для общего перекрёстка выберите роль.';
        $<HTMLButtonElement>('episode-ready').disabled = !episode || !['staging', 'paused'].includes(episode.phase);
        if (session.blocked) keys.clear();
    }
    session.addEventListener('change', renderTask);
    return renderTask;
}
