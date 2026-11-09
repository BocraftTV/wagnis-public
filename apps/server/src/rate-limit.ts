/** In-memory limiter that counts only failed attempts per key (IP) in a sliding window. */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  recordFailure(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
  }

  cleanup(): void {
    for (const key of [...this.failures.keys()]) this.recent(key);
  }
}
