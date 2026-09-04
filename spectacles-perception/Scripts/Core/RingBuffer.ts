/**
 * Fixed-size circular buffer used for temporal history (A1's frame cadence
 * bookkeeping and A4's state-sequence memory). Generic so it can hold
 * lightweight metadata rather than raw textures — keep heavy data (Texture
 * handles) out of long-lived buffers to stay within memory/perf budget.
 */
export class RingBuffer<T> {
  private items: T[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  /** Most recent item, or undefined if empty. */
  latest(): T | undefined {
    return this.items[this.items.length - 1];
  }

  /** Last `n` items, oldest first. */
  recent(n: number): T[] {
    return this.items.slice(Math.max(0, this.items.length - n));
  }

  all(): T[] {
    return this.items.slice();
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
