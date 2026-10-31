import type {Chunk, Meta} from "./types";
import type { ChunkRef, WorldInterest } from "../../network/protocol";
import { Budget } from "./budget";

type FailureCode = "BUDGET" | "FETCH" | "INVALID_DATA";
type WorldEvent = "world_loaded" | "world_load_failed";
type WorldPayload =
  | { revision: number; chunkIds: string[] }
  | { revision: number; code: FailureCode; chunkId: string | null; message: string };
type Ref = Pick<ChunkRef, "id" | "version" | "dataBytes">;
type InterestMetadata = { bytes: number; refs: Set<string> };
type Load = {
  revision: number;
  generation: number;
  controller: AbortController;
  wanted: Ref[];
  pending: Map<string, Ref>;
  active?: string;
};
class LoadError extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); }
}
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
// Resources are validated as empty before a descriptor is retained. A canonical
// representation gives refs shared by snapshots/loads one accounting identity.
const refJSON = (ref: Ref) => JSON.stringify({
  id: ref.id, version: ref.version, dataBytes: ref.dataBytes, resources: [],
});

export class Streamer {
  readonly budget: Budget;
  private readonly worldVersion: string;
  private loaded = new Map<string, Ref>();
  private generation = 0;
  private current?: Load;
  private loads = new Set<Load>();
  private interestMetadata?: InterestMetadata;
  private retainedDescriptorBytes = 0;
  private tail: Promise<void> = Promise.resolve();
  private reserved = 0;
  private latestRevision = -1;

  constructor(
    meta: Meta,
    private mount: (chunk: Chunk) => void,
    private unmount: (id: string) => void,
    private report: (message: string) => void,
    private emit: (type: WorldEvent, payload: WorldPayload) => void = () => {},
    metadataBytes = new TextEncoder().encode(JSON.stringify(meta)).byteLength,
  ) {
    this.worldVersion = meta.version;
    this.budget = new Budget(meta.totalWorldBytes, meta.cacheBudgetBytes, metadataBytes);
  }

  get count() { return this.loaded.size; }
  get reservedBytes() { return this.reserved; }
  get revision() { return this.latestRevision; }

  whenIdle(): Promise<void> { return this.tail; }

  private descriptorBytes(metadata = this.interestMetadata) {
    const seen = new Set(metadata?.refs);
    let bytes = metadata?.bytes ?? 0;
    const add = (ref: Ref) => {
      const key = refJSON(ref);
      if (!seen.has(key)) {
        seen.add(key);
        bytes += new TextEncoder().encode(key).byteLength;
      }
    };
    for (const ref of this.loaded.values()) add(ref);
    for (const load of this.loads)
      for (const ref of load.wanted) add(ref);
    return bytes;
  }

  private refreshDescriptors() {
    const bytes = this.descriptorBytes();
    this.budget.setDescriptorBytes(bytes);
    this.retainedDescriptorBytes = bytes;
  }

  private release(load: Load, id: string) {
    const ref = load.pending.get(id);
    if (ref) {
      this.reserved -= ref.dataBytes;
      load.pending.delete(id);
    }
  }

  private cancel() {
    ++this.generation;
    const load = this.current;
    this.current = undefined;
    if (!load) return;
    load.controller.abort();
    // An abort signal is not proof that a fetch/read has stopped holding data.
    for (const id of load.pending.keys())
      if (id !== load.active) this.release(load, id);
  }

  private evict(id: string) {
    this.unmount(id);
    this.loaded.delete(id);
    this.budget.remove(id);
  }

  clear() {
    this.cancel();
    for (const id of this.loaded.keys()) this.evict(id);
    this.interestMetadata = undefined;
    this.refreshDescriptors();
  }

  private fail(revision: number, code: FailureCode, chunkId: string | null, message: string) {
    this.report(message);
    this.emit("world_load_failed", { revision, code, chunkId, message });
  }

  // Return the queued work directly so the async loader does not retain the
  // caller's full mutable payload as well as its copied descriptor snapshot.
  interest(interest: WorldInterest, measuredBytes?: number): Promise<void> {
    if (!integer(interest.revision)) {
      this.fail(this.revision, "INVALID_DATA", null, "Некорректная ревизия мира");
      return Promise.resolve();
    }
    if (interest.revision <= this.latestRevision) return Promise.resolve();
    this.latestRevision = interest.revision;
    this.cancel();
    this.interestMetadata = undefined;
    this.refreshDescriptors();
    const revision = interest.revision;
    if (interest.worldVersion !== this.worldVersion) {
      this.fail(revision, "INVALID_DATA", null,
        "Изменилась версия мира: требуется новый Streamer с новыми метаданными");
      return Promise.resolve();
    }
    if (!Array.isArray(interest.chunks) || !Array.isArray(interest.removeChunkIds) ||
        !interest.removeChunkIds.every(id => typeof id === "string") ||
        !integer(interest.cacheBudgetBytes) || interest.cacheBudgetBytes === 0) {
      this.fail(revision, "INVALID_DATA", null, "Некорректные параметры загрузки мира");
      return Promise.resolve();
    }
    let payloadBytes: number;
    try {
      if (measuredBytes !== undefined && (!integer(measuredBytes) || measuredBytes === 0))
        throw new Error("Некорректный измеренный размер world_interest");
      // Without a raw frame, serialized payload bytes are the available measure.
      // Never allow a smaller supplied measurement to hide retained JSON data.
      payloadBytes = Math.max(jsonBytes(interest), measuredBytes ?? 0);
    } catch (error) {
      this.fail(revision, "INVALID_DATA", null, String(error));
      return Promise.resolve();
    }
    const refs = new Map<string, Ref>();
    const metadataRefs = new Set<string>();
    const removed = new Set(interest.removeChunkIds);
    for (const ref of interest.chunks) {
      const id = typeof ref?.id === "string" ? ref.id : null;
      if (!id || !integer(ref.version) || !integer(ref.dataBytes) || ref.dataBytes === 0 ||
          !Array.isArray(ref.resources)) {
        this.fail(revision, "INVALID_DATA", id, "Некорректное описание участка");
        return Promise.resolve();
      }
      if (ref.resources.length) {
        this.fail(revision, "INVALID_DATA", id, "Внешние ресурсы не поддерживаются: MVP использует примитивы");
        return Promise.resolve();
      }
      const previous = refs.get(id);
      if (previous && (previous.version !== ref.version || previous.dataBytes !== ref.dataBytes)) {
        this.fail(revision, "INVALID_DATA", id, "Противоречивые версии или размеры участка");
        return Promise.resolve();
      }
      metadataRefs.add(refJSON(ref));
      // Copy the snapshot: callers may replace/mutate their received message later.
      if (!removed.has(id)) refs.set(id, { id, version: ref.version, dataBytes: ref.dataBytes });
    }
    for (const [id, old] of this.loaded) {
      const wanted = refs.get(id);
      if (!wanted || wanted.version !== old.version || wanted.dataBytes !== old.dataBytes) this.evict(id);
    }
    const limit = Math.min(this.budget.limit, interest.cacheBudgetBytes);
    if (this.budget.bytes > limit)
      for (const id of this.loaded.keys()) this.evict(id);
    const pending = new Map([...refs].filter(([id]) => !this.loaded.has(id)));
    const metadata = { bytes: payloadBytes, refs: metadataRefs };
    const descriptors = this.descriptorBytes(metadata);
    const retainedData = this.budget.bytes - this.retainedDescriptorBytes;
    if (descriptors > limit - retainedData - this.reserved) {
      // Do not keep an incoming payload that cannot itself be retained. Keep
      // charging descriptors already held by loaded chunks and stale jobs.
      this.refreshDescriptors();
      this.fail(revision, "BUDGET", null, "WORLD_BUDGET_EXCEEDED: метаданные world_interest");
      return Promise.resolve();
    }
    this.interestMetadata = metadata;
    this.refreshDescriptors();
    let available = limit - this.budget.bytes - this.reserved;
    for (const ref of pending.values()) available -= ref.dataBytes;
    if (available < 0) {
      this.fail(revision, "BUDGET", null,
        "WORLD_BUDGET_EXCEEDED: участки, метаданные и активный резерв превышают бюджет");
      return Promise.resolve();
    }
    const load: Load = {
      revision, generation: this.generation, controller: new AbortController(),
      wanted: [...refs.values()], pending,
    };
    for (const ref of pending.values()) this.reserved += ref.dataBytes;
    this.loads.add(load);
    this.current = load;
    // Serialize even across cancelled revisions: the previous active read must settle.
    const work = this.tail.then(() => this.install(load));
    this.tail = work.catch(() => {});
    return work;
  }

  private live(load: Load) {
    return load.generation === this.generation && !load.controller.signal.aborted;
  }

  private async install(load: Load) {
    try {
      for (const ref of load.pending.values()) {
        if (!this.live(load)) return;
        load.active = ref.id;
        try {
          const response = await fetch(`/api/v1/world/chunks/${encodeURIComponent(ref.id)}`, {
            credentials: "same-origin", cache: "no-store", signal: load.controller.signal,
          });
          if (!this.live(load)) {
            await response.body?.cancel();
            return;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new LoadError("FETCH", `Участок ${ref.id}: HTTP ${response.status}`);
          }
          const chunk = await this.read(response, ref, load);
          if (!this.live(load)) return;
          // Transfer the existing reservation into retained bytes without an await.
          this.budget.add(ref.id, ref.dataBytes);
          this.release(load, ref.id);
          try {
            this.mount(chunk);
            this.loaded.set(ref.id, ref);
          } catch (error) {
            this.budget.remove(ref.id);
            this.unmount(ref.id);
            throw new LoadError("INVALID_DATA", `Не удалось установить участок ${ref.id}: ${String(error)}`);
          }
        } catch (error) {
          if (this.live(load)) {
            const code = error instanceof LoadError ? error.code : "FETCH";
            this.fail(load.revision, code, ref.id, String(error));
          }
          return;
        } finally {
          this.release(load, ref.id);
          load.active = undefined;
        }
      }
      if (this.live(load)) this.emit("world_loaded", {
        revision: load.revision, chunkIds: load.wanted.map(ref => ref.id),
      });
    } finally {
      for (const id of load.pending.keys()) this.release(load, id);
      if (this.current === load) this.current = undefined;
      this.loads.delete(load);
      load.wanted = [];
      this.refreshDescriptors();
    }
  }

  private async read(response: Response, ref: Ref, load: Load): Promise<Chunk> {
    if (!response.body) throw new LoadError("INVALID_DATA", "Отсутствует тело участка");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    let complete = false;
    try {
      while (true) {
        const part = await reader.read();
        if (!this.live(load)) {
          throw new LoadError("INVALID_DATA", "Устаревшая загрузка участка");
        }
        if (part.done) { complete = true; break; }
        bytes += part.value.byteLength;
        if (bytes > ref.dataBytes) {
          throw new LoadError("BUDGET", `WORLD_BUDGET_EXCEEDED: участок ${ref.id} больше dataBytes`);
        }
        try { text += decoder.decode(part.value, { stream: true }); }
        catch { throw new LoadError("INVALID_DATA", "Некорректная кодировка UTF-8 участка"); }
      }
      if (bytes !== ref.dataBytes)
        throw new LoadError("INVALID_DATA", `Размер участка ${ref.id} не совпадает с dataBytes`);
      let value: unknown;
      try { value = JSON.parse(text + decoder.decode()); }
      catch { throw new LoadError("INVALID_DATA", `Некорректный JSON участка ${ref.id}`); }
      if (!record(value) || value.id !== ref.id || value.version !== ref.version)
        throw new LoadError("INVALID_DATA", `ID или версия участка ${ref.id} не совпадает с запросом`);
      if (!Array.isArray(value.resources) || value.resources.length)
        throw new LoadError("INVALID_DATA", "Внешние ресурсы не поддерживаются: MVP использует примитивы");
      if (!record(value.origin) || !finite(value.origin.x) || !finite(value.origin.z) ||
          !finite(value.size) || value.size <= 0 || !Array.isArray(value.objects) ||
          !Array.isArray(value.roads) || !Array.isArray(value.agents))
        throw new LoadError("INVALID_DATA", `Некорректная схема участка ${ref.id}`);
      return value as unknown as Chunk;
    } finally {
      try {
        // A decoder/schema failure must not leave an unread body downloading
        // outside the reservation. Cancellation itself may be asynchronous.
        if (!complete) await reader.cancel();
      } catch {
        // Preserve the original decoding/read failure if cancellation also fails.
      } finally {
        reader.releaseLock();
      }
    }
  }
}
