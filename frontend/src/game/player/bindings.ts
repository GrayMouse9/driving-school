import { $ } from '../../ui/dom';
import type { GameScene } from '../rendering/scene';
import type { Agent } from '../entities/types';
export function bindPlayerInput(game: GameScene, keys: Set<string>, blocked: () => boolean, interact: (agent?: Agent) => void, closeTalk: () => void,chooseAction:(action:string)=>boolean=()=>false) {
    window.addEventListener('keydown', e => {
        if (e.code === 'Escape') {
            closeTalk();
            return;
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
            return;
        const action=({KeyA:'left',ArrowLeft:'left',KeyW:'forward',ArrowUp:'forward',KeyD:'right',ArrowRight:'right',KeyS:'stop',ArrowDown:'stop'} as Record<string,string>)[e.code];
        if(action&&!e.repeat&&chooseAction(action)){e.preventDefault();return;}
        if(blocked())return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
            e.preventDefault();
        keys.add(e.code);
        if (e.code === 'KeyE' && !e.repeat)
            interact();
    });
    window.addEventListener('keyup', e => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('visibilitychange', () => {
        if (document.hidden)
            keys.clear();
    });
    $('view').addEventListener('pointerdown', () => $('view').focus({ preventScroll: true }));
    $('view').onclick = e => {
        const mouse = e as MouseEvent;
        const agent = game.pickAgent(mouse.clientX / innerWidth * 2 - 1, 1 - mouse.clientY / innerHeight * 2);
        if (agent)
            interact(agent);
    };
}
