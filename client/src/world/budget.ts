export class Budget {
  private sizes = new Map<string, number>();
  readonly limit: number;
  constructor(
    readonly total: number,
    serverLimit: number,
  ) {
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      !Number.isSafeInteger(serverLimit) ||
      serverLimit <= 0
    )
      throw new Error("Некорректные метаданные бюджета");
    this.limit = Math.floor(Math.min(serverLimit, total * 0.1));
  }
  get bytes() {
    return [...this.sizes.values()].reduce((a, b) => a + b, 0);
  }
  add(id: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Некорректный размер");
    const next = this.bytes - (this.sizes.get(id) ?? 0) + bytes;
    if (next > this.limit) throw new Error("WORLD_BUDGET_EXCEEDED");
    this.sizes.set(id, bytes);
  }
  remove(id: string) {
    this.sizes.delete(id);
  }
}
