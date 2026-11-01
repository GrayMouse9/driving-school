import { GameScene } from '../game/rendering/scene';
import { renderHud, renderNavigation } from '../ui/hud';
import { readInput, stepPreview } from '../game/player/control';
import { Network, requestId, receivedBytes } from '../network/api';
import { Session } from '../game/interactions/session';
import { Streamer } from '../game/world/streamer';
import { WorldConnection } from '../network/world';
import type { Envelope } from '../network/protocol';
import type { Player, Vehicle } from '../game/entities/types';
import { $, notice, log } from '../ui/dom';
import { bindTaskView } from '../ui/tasks';
import { bindChat } from '../ui/chat';
import { bindAuthentication } from '../auth/bindings';
import { bindInteractions } from '../game/interactions/controller';
import { bindPlayerInput } from '../game/player/bindings';
export function startApplication() {
    let game: GameScene;
    try {
        game = new GameScene($<HTMLCanvasElement>('view'));
    }
    catch (error) {
        $('notice').textContent = `Не удалось запустить WebGL: ${String(error)}`;
        throw error;
    }
    const network = new Network();
    const session = new Session((type, payload, id) => network.send(type, payload, id));
    const keys = new Set<string>();
    const renderTask = bindTaskView(session, keys);
    const interactions = bindInteractions(game, network, session, keys, () => preview);
    bindPlayerInput(game, keys, () => !!session.motion || session.blocked || !$('talk').hidden, interactions.interact, interactions.closeTalk,interactions.chooseAction);
    bindChat(network);
    const world = new WorldConnection((meta, bytes) => new Streamer(meta, c => game.addChunk(c), id => game.removeChunk(id), notice, (type, payload) => network.send(type, payload, requestId()), bytes), notice, (type, payload) => network.send(type, payload, requestId()));
    let preview = false, fixture: {
        players: Player[];
        vehicles: Vehicle[];
    } | undefined;
    let worldEpoch = 0, lastTick = -1, seq = 0, lastState = 0;
    let nearbyPlayers: Player[] = [], nearbyVehicles: Vehicle[] = [];
    let lastMap = 0, lastHud = 0;
    let last = performance.now(), lastInput = 0, frames = 0, fps = 0, fpsStart = last;
    function clearWorld() {
        worldEpoch++;
        nearbyPlayers = [];
        nearbyVehicles = [];
        $('navigation').hidden = true;
        world.clear();
        lastTick = -1;
        for (const id of [...game.chunks.keys()])
            game.removeChunk(id);
        game.clearHints();
        game.snapshot([], []);
        interactions.clear();
        keys.clear();
    }
    function showSession() {
        $('navigation').hidden = false;
        $('login').hidden = true;
        $('chat').hidden = preview;
        $('exercise').hidden = true;
        $('logout').hidden = preview;
        $('view').focus({ preventScroll: true });
    }
    network.addEventListener('status', e => {
        $('connection').textContent = (e as CustomEvent).detail;
    });
    network.addEventListener('disconnected', () => {
        keys.clear();
        clearWorld();
        session.clear();
        if (!preview) {
            $('login').hidden = false;
            $('chat').hidden = true;
            $('exercise').hidden = true;
            $('logout').hidden = true;
        }
    });
    network.addEventListener('message', e => {
        const m = (e as CustomEvent<Envelope>).detail;
        const p = m.payload;
        if (m.type === 'world_joined') {
            nearbyPlayers = [p.player];
            nearbyVehicles = p.vehicles;
            game.selfId = p.selfId;
            lastTick = -1;
            game.snapshot([{ ...p.player, mode: p.player.mode ?? 'driving' }], p.vehicles, p.pedestrians ?? [], p.signals ?? [],p.observers??[]);
            showSession();
            notice('');
        }
        if (m.type === 'players_snapshot' && Number.isSafeInteger(p.tick) && p.tick > lastTick && Array.isArray(p.players) && Array.isArray(p.vehicles)) {
            lastTick = p.tick;
            nearbyPlayers = p.players;
            nearbyVehicles = p.vehicles;
            game.snapshot(p.players.map((player: Player) => ({ ...player, mode: player.mode ?? (player.vehicleId ? 'driving' : 'onFoot') })), p.vehicles, p.pedestrians ?? [], p.signals ?? [],p.observers??[]);
            game.setHiddenObjects(p.hiddenObjectIds??[]);
        }
        if (m.type === 'world_interest')
            void world.interest(p, receivedBytes(m));
        interactions.consume(m);
        if (m.type === 'chat_message')
            log('chat-log', `${p.username}: ${p.text}`);
        if (m.type === 'server_error') {
            notice(p.message);
            renderTask();
        }
        window.dispatchEvent(new CustomEvent('game:server', { detail: m }));
    });
    async function connect() {
        preview = false;
        fixture = undefined;
        $('preview-banner').hidden = true;
        clearWorld();
        session.clear();
        try {
            await network.connect();
        }
        catch (error) {
            notice(String(error));
            $('connection').textContent = 'Нет соединения';
        }
    }
    bindAuthentication(connect, () => network.disconnect());
    const previewButton = document.getElementById('preview');
    if (previewButton) previewButton.onclick = async () => {
        network.disconnect();
        clearWorld();
        session.clear();
        preview = true;
        const epoch = worldEpoch;
        const { previewChunk, previewState } = await import('../game/world/preview');
        if (!preview || epoch !== worldEpoch)
            return;
        fixture = previewState();
        nearbyPlayers = fixture.players;
        nearbyVehicles = fixture.vehicles;
        game.selfId = 'preview-self';
        game.lookYaw = 0;
        game.lookPitch = 0;
        game.addChunk(previewChunk());
        game.snapshot(fixture.players, fixture.vehicles);
        $('preview-banner').hidden = false;
        $('connection').textContent = 'Локальный тест сцены';
        showSession();
        notice('');
    };
    $('leave-preview').onclick = () => {
        preview = false;
        fixture = undefined;
        clearWorld();
        session.clear();
        $('preview-banner').hidden = true;
        $('login').hidden = false;
        $('connection').textContent = 'Нет подключения';
    };
    function frame(now: number) {
        const dt = Math.min(.1, (now - last) / 1000);
        last = now;
        const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        const blocked = focused || session.blocked || !$('talk').hidden || document.hidden;
        const input = readInput(blocked ? new Set() : keys, 0, ++seq);
        input.moveX = 0;
        input.moveZ = 0;
        input.lookYaw = 0;
        if (!network.ready && !preview)
            keys.clear();
        if (network.ready && !session.motion && now - lastInput >= 50) {
            network.input(input);
            lastInput = now;
        }
        if (preview && fixture) {
            const self = fixture.players[0];
            const v = fixture.vehicles.find(v => v.id === self.vehicleId)!;
            const next = stepPreview({ ...v.position, yaw: v.yaw, speed: v.speed }, input, dt);
            v.position = { x: Math.max(-29, Math.min(29, next.x)), y: 0, z: Math.max(-45, Math.min(13, next.z)) };
            v.yaw = next.yaw;
            v.speed = next.speed;
            self.position = { ...v.position };
            self.yaw = v.yaw;
            game.snapshot(fixture.players, fixture.vehicles);
        }
        game.render(dt);
        if (now - lastMap >= 200) {
            lastMap = now;
            renderNavigation(game, nearbyPlayers, nearbyVehicles);
        }
        frames++;
        if (now - fpsStart > 1000) {
            fps = Math.round(frames * 1000 / (now - fpsStart));
            fpsStart = now;
            frames = 0;
        }
        if (now - lastState >= 100) {
            lastState = now;
            window.dispatchEvent(new CustomEvent('game:state', { detail: { player: game.self, vehicle: game.ownVehicle, connected: network.ready, blocked } }));
        }
        if(now-lastHud>=250){lastHud=now;renderHud(game, world, session.blocked, fps,session.motion?.status);}
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
