import type { Envelope, Input } from "../types";
export async function http<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export class Network extends EventTarget {
  private ws?: WebSocket;
  private generation = 0;
  ready = false;
  status(text: string) {
    this.dispatchEvent(new CustomEvent("status", { detail: text }));
  }
  async connect() {
    this.disconnect();
    const generation = this.generation;
    // No socket may be constructed until the cookie session was verified.
    try { await http("/api/me"); } catch(error) {
      if(generation !== this.generation) return;
      throw error;
    }
    if (generation !== this.generation) return;
    this.status("Соединяемся…");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    this.ws = ws;
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const message = JSON.parse(event.data) as Envelope;
        if (
          message.v !== 1 ||
          typeof message.type !== "string" ||
          !message.payload
        )
          throw new Error("Неверный конверт сервера");
        if (message.type === "session.ready") {
          this.ready = true;
          this.status("Подключено");
        }
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      } catch (error) {
        this.status(`Ошибка протокола: ${String(error)}`);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.status("Связь потеряна. Нажмите «Подключиться» для восстановления.");
      this.dispatchEvent(new Event("disconnected"));
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.status("Ошибка соединения");
    };
  }
  send(type: string, payload: unknown, requestId?: string) {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(
      JSON.stringify({
        v: 1,
        type,
        payload,
        ...(requestId ? { requestId } : {}),
      }),
    );
    return true;
  }
  input(payload: Input) {
    return this.send("player.input", payload);
  }
  disconnect() {
    this.generation++;
    this.ready = false;
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.dispatchEvent(new Event("disconnected"));
  }
}
