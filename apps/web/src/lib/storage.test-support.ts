/** Isolated DOM Storage for each browser-adapter test lifetime. */
export class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(item: string): void {
    this.entries.delete(item);
  }
  setItem(item: string, value: string): void {
    this.entries.set(item, value);
  }
  getItem(item: string): string | null {
    return this.entries.get(item) ?? null;
  }
}
