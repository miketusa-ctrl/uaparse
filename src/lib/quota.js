// Usage counters in a SQLite-backed Durable Object (BurnerCheck / DnsGuard QUOTA pattern), with a DAILY
// per-key quota (UTC day) instead of BurnerCheck's monthly one, matching the UAParse profile: free = 1,000/day.
// - Per API key: one instance per key id (idFromName(`key:<keyId>`)), POST /consume — exact (DO input gates
//   serialize get→put). Denied requests write nothing.
// - Shared daily pool: ONE instance named BUDGET_DO_NAME (budget.js), POST /add with batched increments.
// Plain fetch()-style class (no `cloudflare:workers` import) so it is unit-testable in Node.
// Stored per instance: counters only ("q:<YYYY-MM-DD>" = key usage, "d:<YYYY-MM-DD>:<pool>" = pool total).
// No User-Agent strings, no IPs.

export const POOL_FIELDS = ['checks', 'anon'];

export function utcDay(now = new Date()) { return now.toISOString().slice(0, 10); }

/** First instant (ms) of the UTC day `days` after `day` ("YYYY-MM-DD"). */
export function dayStartAfter(day, days = 1) { return Date.parse(`${day}T00:00:00Z`) + days * 86400_000; }

export class KeyQuota {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.clock = () => Date.now(); // overridable in tests
  }

  async fetch(request) {
    const url = new URL(request.url);
    const day = url.searchParams.get('day') || utcDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: 'bad_request' }, { status: 400 });
    if (url.pathname === '/add') {
      if (request.method !== 'POST') return Response.json({ error: 'bad_request' }, { status: 400 });
      const inc = {};
      for (const f of POOL_FIELDS) {
        const n = Number(url.searchParams.get(f) || 0);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return Response.json({ error: 'bad_request' }, { status: 400 });
        inc[f] = n;
      }
      return Response.json(await this.add(day, inc));
    }
    const limit = Number(url.searchParams.get('limit') || 0);
    const n = Number(url.searchParams.get('n') || 1);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(n) || n < 1 || n > 1000) {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
    if (url.pathname === '/peek') {
      const used = (await this.storage.get(`q:${day}`)) || 0;
      return Response.json({ ok: used < limit, used, limit, day });
    }
    if (url.pathname !== '/consume' || request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(await this.consume(day, limit, n));
  }

  /** All-or-nothing: consume n units if they fit under limit for the UTC day. */
  async consume(day, limit, n = 1) {
    const key = `q:${day}`;
    const used = (await this.storage.get(key)) || 0;
    if (used + n > limit) return { ok: false, used, limit, day, requested: n };
    await this.storage.put(key, used + n);
    if (used === 0) await this.ensureCleanup(dayStartAfter(day, 2)); // keep today + yesterday, then delete
    return { ok: true, used: used + n, limit, day };
  }

  async add(day, inc) {
    const totals = { day };
    let first = false;
    for (const f of POOL_FIELDS) {
      const key = `d:${day}:${f}`;
      const cur = (await this.storage.get(key)) || 0;
      if (inc[f] > 0) {
        if (cur === 0) first = true;
        await this.storage.put(key, cur + inc[f]);
      }
      totals[f] = cur + inc[f];
    }
    if (first) await this.ensureCleanup(dayStartAfter(day, 2));
    return totals;
  }

  // Keep the EARLIEST pending alarm.
  async ensureCleanup(at) {
    const cur = await this.storage.getAlarm();
    if (!cur || cur > at) await this.storage.setAlarm(at);
  }

  // Delete counters older than yesterday, then re-arm for the next 00:00 UTC while anything remains.
  async alarm() {
    const now = new Date(this.clock());
    const keepDay = utcDay(new Date(now.getTime() - 86400_000));
    const all = await this.storage.list({ prefix: '' });
    const old = [...all.keys()].filter((k) => (k.startsWith('q:') || k.startsWith('d:')) && k.slice(2, 12) < keepDay);
    if (old.length) await this.storage.delete(old);
    if (all.size > old.length) {
      await this.storage.setAlarm(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    }
  }
}

export class QuotaUnavailable extends Error {
  constructor(message) { super(message); this.code = 'quota_unavailable'; }
}

// Per-isolate memo of keys already at their daily cap ("quotaId|limit" → day): further calls in this isolate
// get the 429 without another billed DO request.
const exhausted = new Map();
export function clearQuotaMemo() { exhausted.clear(); }

/** Consume n lookups from the key's daily quota. Throws QuotaUnavailable if the DO can't be reached. */
export async function consumeDailyQuota(ns, quotaId, limit, n = 1, now = new Date()) {
  if (!ns) throw new QuotaUnavailable('QUOTA binding missing');
  const day = utcDay(now);
  const memoKey = `${quotaId}|${limit}`;
  if (exhausted.get(memoKey) === day) return { ok: false, used: limit, limit, day, memo: true };
  let out;
  try {
    const stub = ns.get(ns.idFromName(quotaId));
    const res = await stub.fetch(`https://quota/consume?day=${day}&limit=${limit}&n=${n}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    out = await res.json();
  } catch (e) {
    throw new QuotaUnavailable(`quota counter unavailable: ${e.message}`);
  }
  if (out && out.ok === false && out.used >= limit) {
    exhausted.set(memoKey, day);
    if (exhausted.size > 5000) exhausted.delete(exhausted.keys().next().value);
  }
  return out;
}
