/**
 * Deterministic pseudo-randomness + hashing primitives.
 *
 * Every synthesised value in Catena's fallback paths is derived from a stable
 * seed (user id + day) so the same twin is reproducible across requests and
 * across the client/server boundary. No Node APIs — Workers-safe.
 */

export function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seeded(...parts: (string | number)[]) {
  return mulberry32(fnv1a(parts.join('|')))
}

/** Gaussian sample via Box–Muller, clamped to a sane range. */
export function gauss(rng: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, rng())
  const v = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

export function round(v: number, digits = 1) {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

export function isoDay(offsetDays = 0, base = new Date()): string {
  const d = new Date(base.getTime() + offsetDays * 86400000)
  return d.toISOString().slice(0, 10)
}

/** SHA-256 hex digest using Web Crypto (available in Workers + browsers). */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
