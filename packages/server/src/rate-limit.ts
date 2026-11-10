export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface MemoryRateLimiterOptions extends Partial<RateLimitOptions> {
  /** Upper bound on tracked keys; the oldest keys are evicted beyond this. Default 10000. */
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until a new request would be allowed (only when not allowed). */
  retryAfter?: number;
}

/** Per-process sliding-window rate limiter with bounded memory. Default: 10 requests / 10 minutes per key. */
export class MemoryRateLimiter {
  readonly windowMs: number;
  readonly max: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(options: MemoryRateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.max = options.max ?? 10;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    this.maybeSweep(now);
    const cutoff = now - this.windowMs;
    const stamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (stamps.length >= this.max) {
      this.hits.set(key, stamps);
      const oldest = stamps[0] ?? now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    stamps.push(now);
    this.hits.delete(key);
    this.hits.set(key, stamps);
    this.enforceMaxKeys();
    return { allowed: true };
  }

  get size(): number {
    return this.hits.size;
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep < Math.min(this.windowMs, 60_000) && this.hits.size < this.maxKeys) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, stamps] of this.hits) {
      const last = stamps[stamps.length - 1];
      if (last === undefined || last <= cutoff) this.hits.delete(key);
    }
  }

  private enforceMaxKeys(): void {
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}
