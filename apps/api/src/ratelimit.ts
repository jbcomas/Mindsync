/** Ventana deslizante en memoria. Suficiente para una instancia; con varias réplicas hay que moverlo a la base/Redis. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  /** Solo para tests. */
  reset() { this.hits.clear(); }

  /** true si el intento está permitido (y lo cuenta). */
  allow(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter(x => t - x < windowMs);
    if (recent.length >= max) { this.hits.set(key, recent); return false; }
    recent.push(t); this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some(x => t - x < windowMs)) this.hits.delete(k);
    return true;
  }
}
