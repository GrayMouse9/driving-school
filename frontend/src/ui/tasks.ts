import { $ } from './dom';
import type { Session } from '../game/interactions/session';
export function bindTaskView(session: Session, keys: Set<string>) {
    function renderTask() {
        const task = session.task;
        $('task').hidden = !task;
        if (task) {
            $('task-source').textContent = task.sourceLabel;
            $('task-title').textContent = task.title;
            $('task-prompt').textContent = task.prompt;
            $('task-options').replaceChildren();
            if (task.kind === 'choice')
                for (const option of task.options) {
                    const b = document.createElement('button');
                    b.textContent = option.text;
                    b.disabled = session.answerPending || !!session.result?.correct;
                    b.onclick = () => {
                        session.answer(option.id);
                    };
                    $('task-options').append(b);
                }
            $('task-feedback').textContent = session.result?.explanation ?? (task.kind === 'driving' ? 'Выполните манёвр. Результат проверяет сервер.' : 'Выберите ответ.');
        }
        const episode = session.episode;
        $('episode-status').textContent = episode ? `Роль ${episode.selfRole ?? '—'} · ${episode.phase}${episode.selfAnswerCorrect ? ' · ответ принят' : ''}` : 'Для общего перекрёстка выберите роль.';
        $<HTMLButtonElement>('episode-ready').disabled = !episode || !['staging', 'paused'].includes(episode.phase);
        if (session.blocked)
            keys.clear();
    }
    session.addEventListener('change', renderTask);
    return renderTask;
}
