import type { Chunk, Meta } from "../types";
import { Budget } from "./budget";
export class Streamer {
  readonly budget: Budget;
  private generation = 0;
  private abort?: AbortController;
  constructor(
    meta: Meta,
    private mount: (chunk: Chunk) => void,
    private unmount: (id: string) => void,
    private report: (message: string) => void,
  ) {
    this.budget = new Budget(
      meta.totalWorldBytes,
      Math.min(meta.cacheBudgetBytes, Math.floor(meta.totalWorldBytes * 0.08)),
    );
  }
  private loaded = new Set<string>();
  get count() {
    return this.loaded.size;
  }
  clear() {
    this.generation++;
    this.abort?.abort();
    for (const id of this.loaded) {
      this.unmount(id);
      this.budget.remove(id);
    }
    this.loaded.clear();
  }
  async interest(ids: string[], remove: string[], serverBudget: number) {
    const generation = ++this.generation;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const wanted = new Set(ids.filter((id) => !remove.includes(id)));
    // Release old GPU and JSON data before fetching replacements.
    for (const id of this.loaded)
      if (!wanted.has(id)) {
        this.unmount(id);
        this.loaded.delete(id);
        this.budget.remove(id);
      }
    if (this.budget.bytes > serverBudget) {
      this.clear();
      this.report("Сервер уменьшил бюджет: требуется повторная загрузка");
      return;
    }
    for (const id of wanted) {
      if (this.loaded.has(id)) continue;
      try {
        const response = await fetch(
          `/api/world/chunks/${encodeURIComponent(id)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          },
        );
        if (!response.ok)
          throw new Error(`Участок ${id}: HTTP ${response.status}`);
        const chunk = (await response.json()) as Chunk;
        if (generation !== this.generation) return;
        if (
          chunk.id !== id ||
          !Array.isArray(chunk.resources) ||
          chunk.resources.length
        )
          throw new Error("Неподдерживаемая схема участка или внешние ресурсы");
        if (this.budget.bytes + chunk.accountedBytes > serverBudget)
          throw new Error("WORLD_BUDGET_EXCEEDED");
        this.budget.add(id, chunk.accountedBytes);
        try {
          this.mount(chunk);
          this.loaded.add(id);
        } catch (error) {
          this.budget.remove(id);
          throw error;
        }
      } catch (error) {
        if (!abort.signal.aborted) this.report(String(error));
      }
    }
  }
}
