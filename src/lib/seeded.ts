/** A small deterministic random source (xorshift32): the same seed always gives the same sequence, in [0, 1). */
export function seeded(seed: string | number): () => number {
  let x = Number(seed) >>> 0 || 1;
  return () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) / 2 ** 32);
}
