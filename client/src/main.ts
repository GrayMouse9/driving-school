import "./style.css";
import { GameScene } from "./game/scene";
import { readInput, stepPreview } from "./game/control";
import { http, Network } from "./network/api";
import { Streamer } from "./world/streamer";
import type { Envelope, Meta, Player, Vehicle } from "./types";
// Temporary integration shell; teammate UI should replace this, not create another socket.
document.querySelector("#app")!.innerHTML =
  `<canvas id="view" aria-label="Учебный город"></canvas><header><div class="brand">АВТОШКОЛА <span>Говорящий город</span></div><div id="connection">Нет подключения</div></header><section id="login" class="panel"><small>УЧЕБНЫЙ ГОРОД</small><h1>Дорога начинается<br>с понимания.</h1><p>Войдите в общий город и познакомьтесь со знаками.</p><form id="auth"><label>Имя<input name="username" autocomplete="username" required maxlength="40"></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button>Войти</button><button type="button" id="register" class="secondary">Зарегистрироваться</button></form><button id="reconnect" class="secondary">Подключиться с текущей сессией</button><button id="preview" class="secondary">Проверка 3D без сервера</button><p id="notice" role="status"></p></section><aside id="diag" class="panel"></aside><footer><div id="hint">WASD — движение · Пробел — тормоз · E — выйти / сесть · мышь — обзор</div><strong><span id="speed">0</span> <small>км/ч</small></strong></footer><section id="talk" class="panel" hidden><button id="close-talk" class="close">×</button><h2 id="sign-name">Знак-помощник</h2><div id="messages" aria-live="polite"></div><form id="ask"><input name="question" placeholder="Вопрос знаку…" maxlength="1000" required><button>Спросить</button></form></section><section id="chat" class="panel" hidden><div id="chat-log" aria-live="polite"></div><form id="chat-form"><input name="text" placeholder="Сообщение участникам" maxlength="500" required><button>↗</button></form></section><div id="feedback" role="status" hidden></div><div id="preview-banner" hidden>ТЕСТ СЦЕНЫ · без сервера, ИИ, сохранений и мультиплеера <button id="leave-preview">Завершить</button></div>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let game: GameScene;
try {
  game = new GameScene($<HTMLCanvasElement>("view"));
} catch (error) {
  $("notice").textContent = `Не удалось запустить WebGL: ${String(error)}`;
  throw error;
}
const network = new Network();
const keys = new Set<string>();
let streamer: Streamer | undefined;
let preview = false;
let fixture: { players: Player[]; vehicles: Vehicle[] } | undefined;
let seq = 0;
let selectedAgent: string | undefined;
let last = performance.now(),
  lastInput = 0,
  frames = 0,
  fps = 0,
  fpsStart = last;
let worldEpoch = 0;
function notice(text: string) {
  $("notice").textContent = text;
  $("feedback").textContent = text;
  $("feedback").hidden = !text;
}
function log(id: string, text: string) {
  const line = document.createElement("p");
  line.textContent = text;
  $(id).append(line);
  while ($(id).childElementCount > 30) $(id).firstElementChild?.remove();
  $(id).scrollTop = $(id).scrollHeight;
}
function clearWorld() {
  worldEpoch++;
  streamer?.clear();
  streamer = undefined;
  for (const id of [...game.chunks.keys()]) game.removeChunk(id);
  game.snapshot([], []);
  selectedAgent = undefined;
  $("talk").hidden = true;
  keys.clear();
}
function showSession() {
  notice("");
  $("login").hidden = true;
  $("chat").hidden = preview;
}
network.addEventListener("status", (e) => {
  $("connection").textContent = (e as CustomEvent).detail;
});
network.addEventListener("disconnected", () => {
  keys.clear();
  if (!preview) {
    $("login").hidden = false;
    $("chat").hidden = true;
    $("talk").hidden = true;
  }
});
network.addEventListener("message", (e) => {
  const m = (e as CustomEvent<Envelope>).detail;
  window.dispatchEvent(new CustomEvent("game:server", { detail: m }));
  const p = m.payload;
  if (m.type === "session.ready") {
    game.selfId = p.selfId;
    game.snapshot([p.player], p.vehicles);
    showSession();
  }
  if (m.type === "state.snapshot") game.snapshot(p.players, p.vehicles);
  if (m.type === "world.interest") {
    void applyInterest(p).catch((error) => notice(String(error)));
  }
  if (m.type === "agent.reply" && selectedAgent === p.agentId) {
    $("sign-name").textContent = p.name;
    log("messages", p.text);
  }
  if (m.type === "chat.message") log("chat-log", `${p.username}: ${p.text}`);
  if (m.type === "lesson.feedback") notice(p.explanation);
  if (m.type === "error") notice(p.message);
});
let metaPromise: Promise<Meta> | undefined;
async function applyInterest(p: {
  allowedChunkIds: string[];
  removeChunkIds: string[];
  cacheBudgetBytes: number;
}) {
  const epoch = worldEpoch;
  metaPromise ??= http<Meta>("/api/world/meta");
  let meta: Meta;
  try {
    meta = await metaPromise;
  } catch (error) {
    metaPromise = undefined;
    throw error;
  }
  if (epoch !== worldEpoch) return;
  streamer ??= new Streamer(
    meta,
    (c) => game.addChunk(c),
    (id) => game.removeChunk(id),
    notice,
  );
  await streamer.interest(
    p.allowedChunkIds,
    p.removeChunkIds,
    p.cacheBudgetBytes,
  );
}
async function connect() {
  preview = false;
  $("preview-banner").hidden = true;
  clearWorld();
  metaPromise = undefined;
  try {
    await network.connect();
  } catch (error) {
    notice(String(error));
    $("connection").textContent = "Нет соединения";
  }
}
$("auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData($<HTMLFormElement>("auth"));
  try {
    await http("/api/auth/login", Object.fromEntries(data));
    await connect();
  } catch (error) {
    notice(String(error));
  }
});
$("register").onclick = async () => {
  const form = $<HTMLFormElement>("auth");
  if (!form.reportValidity()) return;
  try {
    await http("/api/auth/register", Object.fromEntries(new FormData(form)));
    notice("Учётная запись создана. Нажмите «Войти».");
  } catch (error) {
    notice(String(error));
  }
};
$("reconnect").onclick = () => void connect();
$("preview").onclick = async () => {
  network.disconnect();
  clearWorld();
  preview = true;
  const { previewChunk, previewState } = await import("./dev/preview");
  fixture = previewState();
  game.selfId = "preview-self";
  game.lookYaw = 0;
  game.addChunk(previewChunk());
  game.snapshot(fixture.players, fixture.vehicles);
  $("preview-banner").hidden = false;
  $("connection").textContent = "Локальный тест сцены";
  showSession();
};
$("leave-preview").onclick = () => {
  preview = false;
  fixture = undefined;
  clearWorld();
  $("preview-banner").hidden = true;
  $("login").hidden = false;
  $("connection").textContent = "Нет подключения";
};
$("close-talk").onclick = () => {
  $("talk").hidden = true;
  selectedAgent = undefined;
};
$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = $<HTMLFormElement>("ask");
  const text = String(new FormData(form).get("question")).trim();
  if (!text || !selectedAgent) return;
  if (
    network.send(
      "agent.ask",
      { agentId: selectedAgent, text },
      crypto.randomUUID(),
    )
  ) {
    log("messages", `Вы: ${text}`);
    form.reset();
  }
});
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = $<HTMLFormElement>("chat-form");
  const text = String(new FormData(form).get("text")).trim();
  if (text && network.send("chat.send", { text }, crypto.randomUUID()))
    form.reset();
});
function interact() {
  if (!network.ready && !preview) return;
  const self = game.self;
  if (!self) return;
  if (self.vehicleId) {
    if (preview && fixture) {
      const v = fixture.vehicles.find((v) => v.id === self.vehicleId)!;
      if (v.speed > 0.3) return;
      self.mode = "onFoot";
      self.vehicleId = null;
      self.position = { ...v.position, x: v.position.x + 2 };
      v.driverId = null;
    } else network.send("vehicle.exit", {}, crypto.randomUUID());
    return;
  }
  const agent = game.nearestAgent();
  if (agent) {
    selectedAgent = agent.id;
    $("talk").hidden = false;
    $("messages").replaceChildren();
    document.exitPointerLock();
    keys.clear();
    if (preview) {
      log(
        "messages",
        "Это тест геометрии знака. Ответы и память появятся только после подключения сервера.",
      );
    } else
      network.send(
        "agent.ask",
        { agentId: agent.id, text: "Объясни знак" },
        crypto.randomUUID(),
      );
    return;
  }
  const v = game.nearestVehicle();
  if (v) {
    if (preview) {
      self.vehicleId = v.id;
      self.mode = "driving";
      v.driverId = self.id;
      game.lookYaw = 0;
    } else
      network.send("vehicle.enter", { vehicleId: v.id }, crypto.randomUUID());
  }
}
window.addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    !$("talk").hidden
  )
    return;
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyE"].includes(e.code))
    e.preventDefault();
  keys.add(e.code);
  if (e.code === "KeyE" && !e.repeat) interact();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) keys.clear();
});
$("view").onclick = () => {
  if (preview || network.ready) void $("view").requestPointerLock();
};
window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === $("view")) {
    game.lookYaw -= e.movementX * 0.002;
    game.lookPitch = Math.max(
      -0.65,
      Math.min(0.65, game.lookPitch - e.movementY * 0.002),
    );
  }
});
// UI integration point: a single network instance and server event stream.
window.addEventListener("game:command", (e) => {
  const { type, payload, requestId } = (e as CustomEvent).detail;
  network.send(type, payload, requestId);
});
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const input = readInput(keys, game.lookYaw, ++seq);
  if (!network.ready && !preview) keys.clear();
  if (network.ready && now - lastInput >= 50) {
    network.input(input);
    lastInput = now;
  }
  if (preview && fixture) {
    const self = fixture.players[0];
    if (self.vehicleId) {
      const v = fixture.vehicles.find((v) => v.id === self.vehicleId)!;
      const next = stepPreview(
        { ...v.position, yaw: v.yaw, speed: v.speed },
        input,
        dt,
      );
      v.position = {
        x: Math.max(-29, Math.min(29, next.x)),
        y: 0,
        z: Math.max(-45, Math.min(13, next.z)),
      };
      v.yaw = next.yaw;
      v.speed = next.speed;
      self.position = { ...v.position };
      self.yaw = v.yaw;
    } else {
      const norm = Math.max(1, Math.hypot(input.moveX, input.moveZ));
      self.position.x +=
        ((input.moveX * Math.cos(game.lookYaw) +
          input.moveZ * Math.sin(game.lookYaw)) *
          dt *
          3) /
        norm;
      self.position.z +=
        ((-input.moveX * Math.sin(game.lookYaw) +
          input.moveZ * Math.cos(game.lookYaw)) *
          dt *
          3) /
        norm;
    }
    game.snapshot(fixture.players, fixture.vehicles);
  }
  game.render(dt);
  frames++;
  if (now - fpsStart > 1000) {
    fps = Math.round((frames * 1000) / (now - fpsStart));
    fpsStart = now;
    frames = 0;
  }
  $("speed").textContent = String(
    Math.round((game.ownVehicle?.speed ?? 0) * 3.6),
  );
  const b = streamer?.budget;
  $("diag").textContent =
    `${fps} FPS · участки: ${game.chunks.size}\nДанные мира: ${b ? `${b.bytes.toLocaleString()} Б · ${((b.bytes / b.total) * 100).toFixed(2)}% / ${((b.limit / b.total) * 100).toFixed(1)}%` : "не измерены (тест / нет сервера)"}\nГеометрии: ${game.renderer.info.memory.geometries} · текстуры: ${game.renderer.info.memory.textures}\nБайты данных ≠ память GPU. Входящие байты: учёт требует согласования.`;
  const agent = game.nearestAgent();
  $("hint").textContent = game.self?.vehicleId
    ? "WASD — управление · Пробел — тормоз · E — выйти после остановки"
    : agent
      ? "E — поговорить со знаком · WASD — ходьба"
      : game.nearestVehicle()
        ? "E — сесть в машину · WASD — ходьба"
        : "WASD — движение · мышь — обзор · Esc — освободить курсор";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
