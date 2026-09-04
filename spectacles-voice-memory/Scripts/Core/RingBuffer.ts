/** Fixed-size circular buffer. Same small utility as spectacles-perception's, duplicated for standalone use. */
export class RingBuffer<T> {
  private items: T[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  all(): T[] {
    return this.items.slice();
  }

  get length(): number {
    return this.items.length;
  }
}
