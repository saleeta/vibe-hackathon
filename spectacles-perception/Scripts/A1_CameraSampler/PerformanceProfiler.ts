/**
 * Tiny rolling-average profiler so the perception loop can watch its own
 * cost and self-throttle instead of relying on someone noticing battery
 * drain during a demo.
 */
export class PerformanceProfiler {
  private samples: number[] = [];
  private readonly windowSize: number;
  private pendingStartMillis = 0;

  constructor(windowSize: number = 30) {
    this.windowSize = windowSize;
  }

  begin(): void {
    this.pendingStartMillis = getTime() * 1000;
  }

  end(): number {
    const elapsed = getTime() * 1000 - this.pendingStartMillis;
    this.samples.push(elapsed);
    if (this.samples.length > this.windowSize) this.samples.shift();
    return elapsed;
  }

  averageMillis(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  /** True when the loop is consistently eating more than `budgetMillis` per sample. */
  isOverBudget(budgetMillis: number): boolean {
    return this.samples.length >= Math.min(5, this.windowSize) && this.averageMillis() > budgetMillis;
  }
}
