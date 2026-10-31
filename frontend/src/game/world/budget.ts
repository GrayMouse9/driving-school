export class Budget {
  private sizes = new Map<string, number>();
  private descriptorBytes = 0;
  readonly limit: number;

  constructor(
    readonly total: number,
    serverLimit: number,
    private readonly metadataBytes = 0,
  ) {
    if (!Number.isSafeInteger(total) || total <= 0 ||
        !Number.isSafeInteger(serverLimit) || serverLimit <= 0 ||
        !Number.isSafeInteger(metadataBytes) || metadataBytes < 0)
      throw new Error("Некорректные метаданные бюджета");
    this.limit = Math.floor(Math.min(serverLimit, total * 0.08, total * 0.1));
    if (metadataBytes > this.limit) throw new Error("WORLD_BUDGET_EXCEEDED: метаданные");
  }

  get bytes() {
    let bytes = this.metadataBytes + this.descriptorBytes;
    for (const size of this.sizes.values()) bytes += size;
    return bytes;
  }

  setDescriptorBytes(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Некорректный размер метаданных участков");
    if (bytes > this.limit - (this.bytes - this.descriptorBytes))
      throw new Error("WORLD_BUDGET_EXCEEDED: метаданные участков");
    this.descriptorBytes = bytes;
  }

  add(id: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Некорректный размер");
    const remaining = this.limit - (this.bytes - (this.sizes.get(id) ?? 0));
    if (bytes > remaining) throw new Error("WORLD_BUDGET_EXCEEDED");
    this.sizes.set(id, bytes);
  }

  remove(id: string) {
    this.sizes.delete(id);
  }
}
