// Per-isolate LRU cache of parse results keyed by SHA-256(UA). Lives only in this Worker isolate's memory
// (gone when the isolate is recycled), is never written to storage, and holds no IP or key information.
import { parseUA } from './parse.js';

export const CACHE_MAX = 2000;
const cache = new Map();
export function clearParseCache() { cache.clear(); }
export function parseCacheSize() { return cache.size; }

export async function uaHash(ua) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ua));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** → { result, hit }. LRU: a hit moves the entry to the newest end; the oldest entry is evicted past CACHE_MAX. */
export async function parseCached(ua) {
  const h = await uaHash(ua);
  const got = cache.get(h);
  if (got) { cache.delete(h); cache.set(h, got); return { result: got, hit: true }; }
  const result = parseUA(ua);
  cache.set(h, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { result, hit: false };
}
