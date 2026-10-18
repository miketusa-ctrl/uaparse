/**
 * v0.5.0 RapidAPI marketplace route /rapidapi/v1/* (shared pattern: RobotsGate v0.3.0 / HeaderGuard v0.5.0 src/lib/rapidapi.js). RapidAPI's proxy adds
 * X-RapidAPI-Proxy-Secret (must equal the Worker secret RAPIDAPI_PROXY_SECRET) and X-RapidAPI-User. Compare is constant time (SHA-256 digests + XOR). Wrong/missing
 * secret → uniform 401 unauthorized; secret unset → 503. v0.5.1: tier from X-RapidAPI-Subscription (read only AFTER the secret check; unknown → BASIC). Per-minute
 * limit per RapidAPI user on per-tier bindings RAPIDAPI_BASIC_LIMITER 10/min and RAPIDAPI_PRO_LIMITER 120/min, key "rapidapi-<tier>:<16-hex hash of
 * X-RapidAPI-User>", so RapidAPI traffic never eats the free per-IP pool (CHECK_LIMITER), the shared daily pools, or any UAPK/UAPR key quota. Monthly quotas are
 * enforced by RapidAPI (hard limit). UAPK/UAPR keys and the Authorization header are never read on this path.
 */
export const RAPIDAPI_PREFIX = '/rapidapi';
export const RAPIDAPI_TIERS = ['BASIC', 'PRO'];
/** v0.5.1 per-tier per-minute limits */
export const RAPIDAPI_PER_MIN = { BASIC: 10, PRO: 120 };
/** Monthly hard quotas, enforced by RapidAPI (Studio plan settings). */
export const RAPIDAPI_PER_MONTH = { BASIC: 100, PRO: 50_000 };
export const RAPIDAPI_PRICE_USD = { BASIC: 0, PRO: 7 };
export const RAPIDAPI_BINDING = { BASIC: 'RAPIDAPI_BASIC_LIMITER', PRO: 'RAPIDAPI_PRO_LIMITER' };

/** X-RapidAPI-Subscription → tier; missing/unknown counts as BASIC (the lower limit). */
export function rapidTier(request) {
  const t = String(request.headers.get('x-rapidapi-subscription') || '').trim().toUpperCase();
  return RAPIDAPI_TIERS.includes(t) ? t : 'BASIC';
}
export const RAPIDAPI_BULK_MAX = 100;

export function isRapidApiPath(path) { return path === RAPIDAPI_PREFIX || path.startsWith(`${RAPIDAPI_PREFIX}/`); }

async function digest(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)))); }

/** Constant-time equality over fixed-length SHA-256 digests. */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/** Limiter key (16 hex): hashed X-RapidAPI-User (fallback: caller's IP bucket). Never stores the raw username. */
export async function rapidUserKey(request, fallback) {
  const u = String(request.headers.get('x-rapidapi-user') || '').trim().slice(0, 128);
  const src = u ? `u:${u}` : `ip:${fallback}`;
  return [...(await digest(src))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** null when allowed, else { status, code, message }. Never echoes the secret or the presented value. */
export async function rapidGate(request, env) {
  const secret = typeof env.RAPIDAPI_PROXY_SECRET === 'string' ? env.RAPIDAPI_PROXY_SECRET : '';
  if (!secret) return { status: 503, code: 'rapidapi_not_configured', message: 'The RapidAPI route is not configured yet. Use the free API at /v1 directly.' };
  const presented = request.headers.get('x-rapidapi-proxy-secret');
  if (!presented || !(await safeEqual(presented, secret))) {
    return { status: 401, code: 'unauthorized', message: 'Missing or invalid RapidAPI proxy secret. Subscribe on RapidAPI, or use the free public API at /v1.' };
  }
  return null;
}

/**
 * Route handler. h = { json, apiError, readJson, validateUa, parseCached, limited, ipBucket, version, listVersion,
 * maxParseBody, maxBulkBody, maxUaLength, declaredTooLarge }.
 */
export async function handleRapidApi(request, env, path, url, h) {
  const g = await rapidGate(request, env);
  if (g) return h.apiError(g.status, g.code, g.message);
  const method = request.method;
  const tier = rapidTier(request);
  const perMin = RAPIDAPI_PER_MIN[tier];
  const plan = { 'x-uaparse-plan': `rapidapi-${tier.toLowerCase()}` };
  const rate = async () => {
    const key = `rapidapi-${tier.toLowerCase()}:${await rapidUserKey(request, h.ipBucket)}`;
    if (await h.limited(env[RAPIDAPI_BINDING[tier]], key, perMin)) {
      return h.apiError(429, 'rate_limited', `Too many requests for your RapidAPI ${tier} plan (about ${perMin} per minute). Please wait a minute.`, { 'retry-after': '60', ...plan });
    }
    return null;
  };

  if (path === '/rapidapi/v1/health') {
    if (method !== 'GET' && method !== 'HEAD') return h.apiError(405, 'method_not_allowed', 'Use GET /rapidapi/v1/health.', { allow: 'GET' });
    return h.json({ ok: true, service: 'uaparse', version: h.version, plan: 'rapidapi', tier }, 200, plan);
  }

  if (path === '/rapidapi/v1/parse') {
    if (method !== 'GET' && method !== 'POST') return h.apiError(405, 'method_not_allowed', 'Use POST /rapidapi/v1/parse with {"ua":"…"} or GET ?ua=….', { allow: 'GET, POST' });
    let ua;
    if (method === 'POST') {
      if (h.declaredTooLarge(request, h.maxParseBody)) return h.apiError(413, 'body_too_large', `Request body must be at most ${h.maxParseBody} bytes.`);
      const parsed = await h.readJson(request, h.maxParseBody);
      if (parsed.error) return parsed.error;
      const b = parsed.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return h.apiError(400, 'invalid_body', 'Expected {"ua": "…"}.');
      if (b.ua != null && typeof b.ua !== 'string') return h.apiError(400, 'invalid_body', 'ua must be a string.');
      ua = b.ua != null ? b.ua : (request.headers.get('user-agent') || '');
    } else {
      ua = url.searchParams.has('ua') ? url.searchParams.get('ua') : (request.headers.get('user-agent') || '');
    }
    const v = h.validateUa(ua);
    if (v.error) return v.error;
    const rl = await rate();
    if (rl) return rl;
    const { result, hit } = await h.parseCached(v.ua);
    return h.json(result, 200, { ...plan, 'x-cache': hit ? 'HIT' : 'MISS' });
  }

  if (path === '/rapidapi/v1/bulk') {
    if (method !== 'POST') return h.apiError(405, 'method_not_allowed', 'Use POST with {"uas":[…]}.', { allow: 'POST' });
    if (h.declaredTooLarge(request, h.maxBulkBody)) return h.apiError(413, 'body_too_large', `Request body must be at most ${h.maxBulkBody} bytes.`);
    const parsed = await h.readJson(request, h.maxBulkBody);
    if (parsed.error) return parsed.error;
    const uas = parsed.body && Array.isArray(parsed.body.uas) ? parsed.body.uas : null;
    if (!uas) return h.apiError(400, 'invalid_body', 'Expected {"uas": ["…", …]}.');
    if (uas.length === 0) return h.apiError(400, 'empty_batch', 'uas must contain at least one User-Agent.');
    if (uas.length > RAPIDAPI_BULK_MAX) return h.apiError(400, 'too_many_uas', `At most ${RAPIDAPI_BULK_MAX} User-Agents per bulk call (got ${uas.length}).`);
    const badIdx = uas.findIndex((e) => typeof e !== 'string' || !e.trim() || e.length > h.maxUaLength);
    if (badIdx >= 0) return h.apiError(400, 'invalid_ua_item', `uas[${badIdx}] must be a non-empty string of at most ${h.maxUaLength} characters.`);
    const rl = await rate();
    if (rl) return rl;
    const results = [];
    for (const u of uas) results.push((await h.parseCached(u)).result);
    return h.json({ count: uas.length, list_version: h.listVersion, results }, 200, plan);
  }

  return h.apiError(404, 'not_found', 'Unknown RapidAPI endpoint. Use /rapidapi/v1/parse, /rapidapi/v1/bulk or /rapidapi/v1/health.');
}
