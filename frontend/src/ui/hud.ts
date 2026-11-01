import { $ } from './dom';
import { drawMinimap } from './minimap';
import type { GameScene } from '../game/rendering/scene';
import type { WorldConnection } from '../network/world';
import type { Player, Vehicle } from '../game/entities/types';
export function renderNavigation(game: GameScene, nearbyPlayers: Player[], nearbyVehicles: Vehicle[]) {
    drawMinimap($<HTMLCanvasElement>('minimap'), [...game.chunks.values()].map(c => c.data), nearbyPlayers, nearbyVehicles, game.selfId);
    $('participants').textContent = `В городе: ${nearbyPlayers.length} · ${nearbyPlayers.map(p => p.username).join(', ')}`;
}
export function renderHud(game: GameScene, world: WorldConnection, blocked: boolean, fps: number) {
    const b = world.accounting?.budget, reserved = world.reservedBytes;
    $('diag').textContent = `${fps} FPS · участки: ${game.chunks.size}\n${b ? `Удерживается: ${b.bytes} Б · резерв: ${reserved} Б\nВсего мир: ${b.total} Б · доля: ${((b.bytes + reserved) / b.total * 100).toFixed(2)}%\nРабочий лимит: ${b.limit} Б · жёсткий: 10%` : 'Данные мира не измерены: тест / нет сервера'}\nГеометрии: ${game.renderer.info.memory.geometries} · текстуры: ${game.renderer.info.memory.textures}\nБайты данных ≠ память GPU.`;
    $('hint').textContent = blocked ? 'Ответьте на задание. Управление вашей машиной приостановлено.' : game.nearestAgent() ? 'Остановитесь · E или щелчок по знаку — поговорить' : 'W/↑ — вперёд · S/↓ — назад · A/D или ←/→ — поворот';
}
