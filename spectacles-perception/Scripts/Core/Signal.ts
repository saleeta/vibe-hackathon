/**
 * Minimal typed pub/sub, independent of any Lens Studio event (SceneEvent etc.)
 * so it works the same whether the subscriber is another module in this
 * package, the main app, or Person B's integration script.
 */
export class Signal<T> {
  private listeners: Array<(data: T) => void> = [];

  add(callback: (data: T) => void): (data: T) => void {
    this.listeners.push(callback);
    return callback;
  }

  remove(callback: (data: T) => void): void {
    const i = this.listeners.indexOf(callback);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  invoke(data: T): void {
    // Copy in case a listener adds/removes during dispatch.
    for (const listener of this.listeners.slice()) {
      listener(data);
    }
  }

  clear(): void {
    this.listeners.length = 0;
  }
}
