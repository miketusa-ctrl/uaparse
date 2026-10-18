// Request router. Kept free of Worker-only imports so it can be unit-tested in Node (node --test).
import { parseCached, clearParseCache } from './lib/cache.js';
import { parseUA, MAX_UA_LENGTH, PARSER } from './lib/parse.js';
import { LIST_VERSION, BOT_COUNT, AI_CRAWLER_COUNT, AI_AGENT_COUNT, AI_AGENT_CURRENT_COUNT, AI_AGENT_RETIRED, AI_PURPOSE_TEXT, AI_AGENT_KIND_TEXT, botList } from './lib/detect.js';
import { extractApiKey, lookupKey, StorageError, PLANS, KEY_PREFIX } from './lib/keys.js';
import { validateFleetLicense } from './lib/fleet-license.js';
import { PRO_CHECKOUT_URL, PRO_PORTAL_URL, PRO_PRODUCT_SLUG, PRO_KEY_PREFIX, looksLikeProKey, proKeyIdFor } from './lib/pro.js';
import { consumeDailyQuota, QuotaUnavailable, dayStartAfter, utcDay } from './lib/quota.js';
import { budgetAllows, budgetRecord, secondsToUtcMidnight } from './lib/budget.js';
import { VERSION } from './lib/version.js';
import { handleMcp, MCP_CORS } from './lib/mcp.js';
import { llmsTxt, openApiSpec, GLAMA_JSON } from './lib/agentdocs.js';
import { isRapidApiPath, handleRapidApi } from './lib/rapidapi.js';

export { clearParseCache, VERSION, PRO_CHECKOUT_URL };
export const MAX_PARSE_BODY = 8 * 1024; // POST /v1/parse
export const MAX_BULK_BODY = 64 * 1024; // POST /v1/bulk
export const MAX_BATCH = 100; // hard ceiling; a free key is also capped by its plan's bulk_max (10)
export const CONTACT = 'digitalpromohub.support@gmail.com';
export const ROBOTSGATE_URL = 'https://robotsgate.mike-tusa.workers.dev';

// Defaults match wrangler.toml [vars]; per-minute numbers must also match the ratelimit bindings' simple.limit.
export const DEFAULT_LIMITS = {
  anonPerMin: 20, // ANON_CHECKS_PER_MIN / CHECK_LIMITER (per IP)
  keyPerMin: 120, // KEY_CHECKS_PER_MIN / KEY_LIMITER (per API key; a bulk call counts as 1 request)
  checksPerDay: 15000, // DAILY_CHECK_POOL: all lookups, all users (approximate; budget.js)
  anonPerDay: 10000, // DAILY_ANON_CHECK_POOL: anonymous share; the rest is kept for key holders
};
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; }
export function limitsFor(env = {}) {
  const L = DEFAULT_LIMITS;
  return {
    anonPerMin: num(env.ANON_CHECKS_PER_MIN, L.anonPerMin),
    keyPerMin: num(env.KEY_CHECKS_PER_MIN, L.keyPerMin),
    checksPerDay: num(env.DAILY_CHECK_POOL, L.checksPerDay),
    anonPerDay: num(env.DAILY_ANON_CHECK_POOL, L.anonPerDay),
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-expose-headers': 'x-quota-limit, x-quota-remaining, x-quota-reset, x-cache, retry-after',
  'access-control-max-age': '86400',
};
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Own icon (no third-party logo), referenced by server.json for the MCP Registry.
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f766e"/><text x="16" y="21.5" font-family="system-ui,sans-serif" font-size="13" font-weight="700" text-anchor="middle" fill="#fff">UA</text></svg>';

const isStaging = (env) => String(env.PUBLIC_LAUNCH || 'false') !== 'true';

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...SECURITY, ...extra },
  });
}
const apiError = (status, code, message, extra) => json({ error: { code, message } }, status, extra);

// Per-isolate fallback limiter (used only when a ratelimit binding is missing, e.g. tests / local dev).
const memLimits = new Map();
function memLimit(key, limit, periodMs = 60_000) {
  const now = Date.now();
  const e = memLimits.get(key);
  if (!e || now - e.start > periodMs) { memLimits.set(key, { start: now, n: 1 }); if (memLimits.size > 5000) memLimits.clear(); return true; }
  e.n++;
  return e.n <= limit;
}
export function clearMemLimits() { memLimits.clear(); }

async function limited(binding, key, limit) {
  if (binding && typeof binding.limit === 'function') {
    try { const { success } = await binding.limit({ key }); return !success; } catch { /* fall back */ }
  }
  return !memLimit(key, limit);
}

class BodyTooLarge extends Error {}

/** Read at most `cap` bytes of the body; throws BodyTooLarge as soon as the real byte count passes the cap. */
async function readCapped(request, cap) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* ignore */ } throw new BodyTooLarge(); }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(buf);
}

function quotaHeaders(q) {
  const reset = new Date(dayStartAfter(q.day || utcDay(), 1)).toISOString();
  return { 'x-quota-limit': String(q.limit), 'x-quota-remaining': String(Math.max(0, q.limit - q.used)), 'x-quota-reset': reset };
}

/**
 * Per-IP limiter bucket: IPv4 as is; IPv6 → its /64, because one subscriber controls a whole /64 and could otherwise
 * rotate addresses to dodge the anonymous per-IP limit. Same output as the account's ipBucket. Used for the anonymous
 * limiter, the failed-auth limiter and the MCP discovery cap.
 */
export function ipBucket(ip) {
  const s = String(ip || 'unknown').trim().toLowerCase();
  if (!s.includes(':')) return s;
  if (s.includes('.')) return s.slice(s.lastIndexOf(':') + 1); // IPv4-mapped ::ffff:a.b.c.d
  const [h, t] = s.split('::'), head = h ? h.split(':') : [], tail = t ? t.split(':') : [];
  const parts = t === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return parts.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}

const fail = (status, code, message, headers = {}) => ({ ok: false, status, code, message, headers });
const failResponse = (r) => apiError(r.status, r.code, r.message, r.headers);

// Failed authentication is rate limited per IP bucket.
const authFailBlocked = new Map();
export function clearAuthFailMemo() { authFailBlocked.clear(); }
const tooManyAuthFailures = () => fail(429, 'too_many_failed_auth', 'Too many requests with an invalid API key from this IP. Wait a minute.', { 'retry-after': '60' });

/**
 * Key gate shared by /v1/parse, /v1/bulk and POST /mcp (identical behaviour = auth parity).
 * → { ok:true, kind:'anon', rec:null } | { ok:true, kind:'key', rec } | { ok:false, status, code, message, headers }.
 * A present-but-bad Authorization header is a 401, never a silent fallback to anonymous. Never echoes the key.
 * v0.4.0: a UAPR-… key is a Polar Pro license, checked against the shared LICENSES KV (fleet-license.js; local KV read,
 * no Polar HTTP). Fail-safe like DnsGuard: missing binding, KV error, unknown, revoked, expired or wrong product → the
 * same 401 (never Pro, never a silent fallback to anonymous), and it counts toward the failed-auth limiter.
 */
export async function authenticate(request, env = {}) {
  const raw = extractApiKey(request);
  if (raw === null) return { ok: true, kind: 'anon', rec: null };
  const bucket = ipBucket(request.headers.get('cf-connecting-ip'));
  const until = authFailBlocked.get(bucket);
  if (until && until > Date.now()) return tooManyAuthFailures();
  if (!raw.startsWith(KEY_PREFIX) && looksLikeProKey(raw)) {
    const lic = await validateFleetLicense(env.LICENSES, raw, PRO_PRODUCT_SLUG);
    if (!lic.valid) return authFailure(env, bucket, 'Unknown or inactive UAParse Pro license key. Check your subscription in the Polar customer portal.');
    const plan = PLANS.pro;
    return { ok: true, kind: 'key', rec: { keyId: await proKeyIdFor(raw), plan: 'pro', daily: plan.daily, bulkMax: plan.bulk_max, license: true } };
  }
  if (!env.KEYS) return fail(503, 'keys_unavailable', 'API keys are not available on this deployment yet.');
  let rec;
  try { rec = await lookupKey(env.KEYS, raw); } catch (e) {
    if (e instanceof StorageError) return fail(503, 'storage_unavailable', 'Key storage is temporarily unavailable. Please retry shortly.', { 'retry-after': '60' });
    throw e;
  }
  if (!rec) return authFailure(env, bucket, `Unknown or malformed API key. Use: Authorization: Bearer ${KEY_PREFIX}…`);
  return { ok: true, kind: 'key', rec };
}

async function authFailure(env, bucket, message) {
  if (await limited(env.CHECK_LIMITER, `authfail:${bucket}`, limitsFor(env).anonPerMin)) {
    authFailBlocked.set(bucket, Date.now() + 60_000);
    if (authFailBlocked.size > 5000) authFailBlocked.delete(authFailBlocked.keys().next().value);
    return tooManyAuthFailures();
  }
  return fail(401, 'invalid_api_key', message, { 'www-authenticate': 'Bearer' });
}

/**
 * One lookup (input.ua) or one bulk batch (input.uas, already validated) with every per-minute / per-day /
 * shared-pool limit applied, then the parse (per-isolate SHA-256 cache). Used by /v1/parse, /v1/bulk, the no-JS form
 * and the MCP tools/call handler, so one MCP tool call = one lookup against the same counters.
 * Order (unchanged from v0.2.1 so the REST contract stays byte-identical): limiter → daily pool → daily key quota →
 * parse. Unlike DnsGuard, a cache HIT still counts: UAParse documents every lookup as counted and returns exact
 * X-Quota-* headers on keyed hits; a parse is pure CPU (no upstream), so there is no upstream work to save.
 * → { ok:true, body, headers, cached } | { ok:false, status, code, message, headers }.
 */
export async function runCheck({ input, auth, env = {}, ctx = {}, ip }) {
  const limits = limitsFor(env);
  const n = input.uas ? input.uas.length : 1;
  if (auth.kind === 'anon') {
    if (await limited(env.CHECK_LIMITER, `ip:${ipBucket(ip)}`, limits.anonPerMin)) {
      return fail(429, 'rate_limited', `Too many lookups: about ${limits.anonPerMin} per minute per IP without an API key. Wait a minute or use an API key.`, { 'retry-after': '60' });
    }
  } else if (await limited(env.KEY_LIMITER, `key:${auth.rec.keyId}`, limits.keyPerMin)) {
    return fail(429, 'rate_limited', `Too many requests: about ${limits.keyPerMin} per minute per API key.`, { 'retry-after': '60' });
  }
  // Polar Pro licenses have their own daily quota and do not draw on the shared free pools (DnsGuard Pro pattern).
  const pool = auth.rec && auth.rec.license ? { ok: true } : budgetAllows(auth.kind, limits, n);
  if (!pool.ok) {
    return fail(429, 'daily_capacity_reached', 'UAParse has reached its shared daily capacity. It resets at 00:00 UTC.', { 'retry-after': String(secondsToUtcMidnight()) });
  }
  let headers = {};
  if (auth.kind === 'key') {
    let q;
    try { q = await consumeDailyQuota(env.QUOTA, `key:${auth.rec.keyId}`, auth.rec.daily, n); } catch (e) {
      if (e instanceof QuotaUnavailable) return fail(503, 'quota_unavailable', 'Usage counter temporarily unavailable. Please retry shortly.', { 'retry-after': '30' });
      throw e;
    }
    headers = quotaHeaders(q);
    if (!q.ok) {
      const resetIn = Math.ceil((dayStartAfter(q.day || utcDay(), 1) - Date.now()) / 1000);
      const msg = q.used < q.limit
        ? `This batch needs ${n} lookups but only ${q.limit - q.used} remain today.`
        : `Daily quota of ${q.limit.toLocaleString('en-US')} lookups used. It resets at 00:00 UTC.`;
      return fail(429, 'quota_exceeded', msg, { ...headers, 'retry-after': String(Math.max(1, resetIn)) });
    }
  }
  if (!(auth.rec && auth.rec.license)) budgetRecord(auth.kind, env.QUOTA, ctx, n);
  if (input.uas) {
    const results = [];
    for (const u of input.uas) results.push((await parseCached(u)).result);
    return { ok: true, body: { count: n, list_version: LIST_VERSION, results }, headers, cached: false };
  }
  const { result, hit } = await parseCached(input.ua);
  return { ok: true, body: result, headers: { ...headers, 'x-cache': hit ? 'HIT' : 'MISS' }, cached: hit };
}

function fill(tpl, env) {
  return tpl
    .replaceAll('{{VERSION}}', VERSION)
    .replaceAll('{{LIST_VERSION}}', LIST_VERSION)
    .replaceAll('{{BOT_COUNT}}', String(BOT_COUNT))
    .replaceAll('{{AI_COUNT}}', String(AI_CRAWLER_COUNT))
    .replaceAll('{{AGENT_COUNT}}', String(AI_AGENT_COUNT))
    .replaceAll('{{AGENT_CURRENT_COUNT}}', String(AI_AGENT_CURRENT_COUNT))
    .replaceAll('{{AGENT_RETIRED}}', AI_AGENT_RETIRED.join(', '))
    .replaceAll('{{PARSER}}', PARSER)
    .replaceAll('{{CONTACT}}', CONTACT)
    .replaceAll('{{ROBOTSGATE}}', ROBOTSGATE_URL)
    .replaceAll('{{ANON_PER_MIN}}', String(limitsFor(env).anonPerMin))
    .replaceAll('{{PRO_CHECKOUT}}', PRO_CHECKOUT_URL)
    .replaceAll('{{PRO_PORTAL}}', PRO_PORTAL_URL)
    .replaceAll('{{PRO_PRICE}}', String(PLANS.pro.price_usd))
    .replaceAll('{{PRO_DAILY}}', PLANS.pro.daily.toLocaleString('en-US'))
    .replaceAll('{{PRO_BULK}}', String(Math.min(PLANS.pro.bulk_max, MAX_BATCH)))
    .replaceAll('{{MAX_BATCH}}', String(MAX_BATCH));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function botBadge(r) {
  if (r.is_ai_agent) return ['warn', 'AI agent (acting for a user)', `${r.bot.name || 'AI agent'} (${r.bot.operator || 'unknown operator'}). ${AI_AGENT_KIND_TEXT[r.bot.ai_agent_kind] || ''}`.trim()];
  if (r.is_ai_crawler) return ['warn', 'AI crawler', `${r.bot.name || 'AI crawler'} (${r.bot.operator || 'unknown operator'}). ${AI_PURPOSE_TEXT[r.bot.ai_purpose] || ''}`.trim()];
  if (r.is_search_crawler) return ['info', 'Search crawler', `${r.bot.name || 'Search crawler'} (${r.bot.operator || 'unknown'}).`];
  if (r.is_bot) {
    const label = r.bot.category_label || 'Bot';
    const name = r.bot.name ? `${r.bot.name} · ${label}` : label;
    return ['info', name, r.bot.operator ? `Operator: ${r.bot.operator}.` : 'Looks like a bot or automated client.'];
  }
  return ['good', 'Human browser', 'Not on our bot / crawler list.'];
}

/** Server-rendered result for the no-JS form fallback (POST /). Everything is escaped. */
function resultHtml(r) {
  const [cls, label, text] = botBadge(r);
  const flags = [
    ['Browser', [r.browser.name, r.browser.version].filter(Boolean).join(' ') || '—'],
    ['OS', [r.os.name, r.os.version].filter(Boolean).join(' ') || '—'],
    ['Device', r.device.type],
    ['Engine', [r.engine.name, r.engine.version].filter(Boolean).join(' ') || '—'],
    ['Bot', r.is_bot ? 'yes' : 'no'],
    ['AI crawler', r.is_ai_crawler ? 'yes' : 'no'],
    ['AI agent', r.is_ai_agent ? 'yes' : 'no'],
    ['Search crawler', r.is_search_crawler ? 'yes' : 'no'],
  ].map(([k, v]) => `<li><span>${k}</span><strong class="${String(v) === 'yes' ? 'y' : String(v) === 'no' ? 'n' : ''}">${escapeHtml(String(v))}</strong></li>`).join('');
  const note = r.is_ai_crawler
    ? `<p class="sugg">Want robots.txt rules for AI crawlers? Try <a href="${ROBOTSGATE_URL}" target="_blank" rel="noopener noreferrer">RobotsGate</a>.</p>`
    : '';
  const docs = r.bot.info_url
    ? `<p class="small muted">Operator documentation: <a href="${escapeHtml(r.bot.info_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.bot.info_url)}</a> (UA not verified).</p>`
    : '';
  const tok = r.bot.token_only
    ? `<p class="small muted">${escapeHtml(r.bot.name)} is documented as a robots.txt token only (requests usually use another User-Agent).</p>`
    : '';
  return `<section class="result"><div class="verdict"><span class="badge ${cls}">${escapeHtml(label)}</span><span>${escapeHtml(text)}</span></div>`
    + `<p class="small muted">UA: ${escapeHtml(r.ua.slice(0, 120))}${r.ua.length > 120 ? '…' : ''} · list ${escapeHtml(r.list_version)}</p>`
    + `<ul class="flags">${flags}</ul>${tok}${docs}${note}</section>`;
}
const errorHtml = (msg) => `<p class="err" role="alert">${escapeHtml(msg)}</p>`;

async function readJson(request, cap) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) return { error: apiError(415, 'unsupported_media_type', 'Send Content-Type: application/json.') };
  let text;
  try { text = await readCapped(request, cap); } catch (e) {
    if (e instanceof BodyTooLarge) return { error: apiError(413, 'body_too_large', `Request body must be at most ${cap} bytes.`) };
    return { error: apiError(400, 'invalid_body', 'Body must be UTF-8 JSON.') };
  }
  try { return { body: JSON.parse(text) }; } catch { return { error: apiError(400, 'invalid_json', 'Body is not valid JSON.') }; }
}
const declaredTooLarge = (request, cap) => {
  const cl = request.headers.get('content-length');
  return cl != null && (!/^\d+$/.test(cl) || Number(cl) > cap);
};

function validateUa(ua) {
  if (ua == null || typeof ua !== 'string') return { error: apiError(400, 'missing_ua', 'Send {"ua":"…"} or ?ua=… (or omit to parse the request User-Agent).') };
  if (!ua.trim()) return { error: apiError(400, 'empty_ua', 'ua must not be empty.') };
  if (ua.length > MAX_UA_LENGTH) return { error: apiError(400, 'ua_too_long', `ua must be at most ${MAX_UA_LENGTH} characters.`) };
  return { ua };
}

export function createApp({ html = '', docs = '', privacy = '', js = '', css = '' } = {}) {
  const pageCache = new Map();
  const page = (name, tpl, env) => {
    const k = `${name}|${limitsFor(env).anonPerMin}`;
    if (!pageCache.has(k)) pageCache.set(k, fill(tpl, env));
    return pageCache.get(k);
  };

  async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const limits = limitsFor(env);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    // v0.3.0: remote MCP server (Streamable HTTP, stateless, JSON responses). Same key gate + limits as /v1/parse.
    // Routed before the generic OPTIONS handler so its preflight advertises the MCP headers (POST, OPTIONS only).
    if (path === '/mcp') {
      return handleMcp(request, env, ctx, {
        authenticate, runCheck, ip, ipBucket: ipBucket(ip), origin: url.origin, memLimit,
        cors: MCP_CORS, security: SECURITY, allowedOrigins: env.MCP_ALLOWED_ORIGINS, anonPerMin: limits.anonPerMin,
      });
    }

    // v0.5.0 RapidAPI marketplace route (RobotsGate pattern): proxy-secret gate first, own RAPIDAPI_LIMITER keyed by
    // X-RapidAPI-User, same parse functions as /v1. UAPK/UAPR keys are never read here.
    if (isRapidApiPath(path) && method !== 'OPTIONS') {
      return handleRapidApi(request, env, path, url, {
        json, apiError, readJson, validateUa, parseCached, limited, declaredTooLarge, ipBucket: ipBucket(ip), version: VERSION,
        listVersion: LIST_VERSION, maxParseBody: MAX_PARSE_BODY, maxBulkBody: MAX_BULK_BODY, maxUaLength: MAX_UA_LENGTH,
      });
    }

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, ...SECURITY } }); // Security headers on preflight too

    // v0.3.0: agent discovery documents (plain text / JSON; OPTIONS is answered above with the API CORS headers).
    if (path === '/llms.txt' || path === '/openapi.json' || path === '/.well-known/mcp-registry-auth' || path === '/.well-known/glama.json') {
      if (method !== 'GET' && method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Use GET.', { allow: 'GET, HEAD, OPTIONS' });
      const doc = (body, type, cache = 'public, max-age=3600') => new Response(method === 'HEAD' ? null : body, { headers: { 'content-type': type, 'cache-control': cache, ...CORS, ...SECURITY } });
      const C = { MAX_PARSE_BODY, MAX_BULK_BODY, MAX_BATCH, CONTACT, ROBOTSGATE_URL };
      if (path === '/llms.txt') return doc(llmsTxt(url.origin, limits, C), 'text/plain; charset=utf-8');
      if (path === '/openapi.json') return doc(JSON.stringify(openApiSpec(url.origin, limits, C), null, 2), 'application/json; charset=utf-8');
      if (path === '/.well-known/glama.json') return doc(GLAMA_JSON, 'application/json'); // v0.5.2 Glama claim (public, max-age=3600)
      // Official MCP Registry HTTP namespace proof. Only a PUBLIC key record may live in the MCP_REGISTRY_AUTH var;
      // 404 unless it is set and well-formed.
      const proof = String(env.MCP_REGISTRY_AUTH || '').trim();
      if (/^v=MCPv1; k=(ed25519|ecdsap384); p=[A-Za-z0-9+/=]{20,120}$/.test(proof)) return doc(`${proof}\n`, 'text/plain; charset=utf-8', 'no-store');
      return apiError(404, 'not_found', 'Not found. API docs: /docs');
    }

    const asset = (body, type, extra = {}) => new Response(method === 'HEAD' ? null : body, {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=300', ...SECURITY, 'content-security-policy': CSP, ...extra },
    });
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/') return asset(page('index', html, env).replace('{{NOJS_RESULT}}', ''), 'text/html; charset=utf-8');
      if (path === '/docs' || path === '/docs/') return asset(page('docs', docs, env), 'text/html; charset=utf-8');
      if (path === '/app.js') return asset(js, 'text/javascript; charset=utf-8');
      if (path === '/style.css') return asset(css, 'text/css; charset=utf-8');
      if (path === '/privacy' || path === '/privacy/') return asset(page('privacy', privacy, env), 'text/html; charset=utf-8');
      if (path === '/robots.txt') {
        const body = isStaging(env) ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\nDisallow: /v1/\n';
        return asset(body, 'text/plain; charset=utf-8');
      }
      if (path === '/favicon.ico') return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=86400' } });
      if (path === '/favicon.svg') return asset(FAVICON_SVG, 'image/svg+xml', { 'cache-control': 'public, max-age=86400' }); // v0.3.0: server.json icon
      if (path === '/health') {
        return json({ ok: true, service: 'uaparse', version: VERSION, build: String(env.BUILD_SHA || 'dev') });
      }
    }

    // No-JS fallback for the checker form (POST /). Same 8 KB cap and the same anonymous per-IP limiter / daily pool as the API.
    if (path === '/' && method === 'POST') {
      const render = (inner, status = 200) => new Response(page('index', html, env).replace('{{NOJS_RESULT}}', inner), {
        status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY, 'content-security-policy': CSP },
      });
      if (declaredTooLarge(request, MAX_PARSE_BODY)) return render(errorHtml('Request too large.'), 413);
      let text;
      try { text = await readCapped(request, MAX_PARSE_BODY); } catch (e) {
        return e instanceof BodyTooLarge ? render(errorHtml('Request too large.'), 413) : render(errorHtml('Could not read the form.'), 400);
      }
      const q = (new URLSearchParams(text).get('ua') || '').trim();
      if (!q) return render(errorHtml('Paste a User-Agent string, or use Detect mine.'), 400);
      if (q.length > MAX_UA_LENGTH) return render(errorHtml(`Please enter at most ${MAX_UA_LENGTH} characters.`), 400);
      const r = await runCheck({ input: { ua: q }, auth: { kind: 'anon' }, env, ctx, ip });
      if (!r.ok) return render(errorHtml(r.message), r.status);
      return render(resultHtml(r.body));
    }

    if (!path.startsWith('/v1/')) return apiError(404, 'not_found', 'Not found. API docs: /docs');

    if (path === '/v1/meta') {
      if (method !== 'GET' && method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Use GET.', { allow: 'GET' });
      return json({
        service: 'uaparse',
        version: VERSION,
        build: String(env.BUILD_SHA || 'dev'),
        list_version: LIST_VERSION,
        bot_count: BOT_COUNT,
        ai_crawler_count: AI_CRAWLER_COUNT,
        ai_agent_count: AI_AGENT_COUNT,
        parser: PARSER,
        limits: {
          anonymous_per_min: limits.anonPerMin,
          key_per_min: limits.keyPerMin,
          batch_max: MAX_BATCH,
          max_parse_body_bytes: MAX_PARSE_BODY,
          max_bulk_body_bytes: MAX_BULK_BODY,
          max_ua_length: MAX_UA_LENGTH,
          plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, { lookups_per_day: v.daily, bulk_max: v.bulk_max }])),
        },
        pro: { price_usd_per_month: PLANS.pro.price_usd, checkout_url: PRO_CHECKOUT_URL, key_prefix: `${PRO_KEY_PREFIX}-`, portal_url: PRO_PORTAL_URL },
      });
    }

    if (path === '/v1/bots') {
      if (method !== 'GET' && method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Use GET.', { allow: 'GET' });
      return json({ list_version: LIST_VERSION, count: BOT_COUNT, bots: botList() });
    }

    if (path === '/v1/parse') {
      if (method !== 'GET' && method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST /v1/parse with {"ua":"…"} (recommended) or GET /v1/parse?ua=….', { allow: 'GET, POST' });
      let ua;
      let who;
      if (method === 'POST') {
        if (declaredTooLarge(request, MAX_PARSE_BODY)) return apiError(413, 'body_too_large', `Request body must be at most ${MAX_PARSE_BODY} bytes.`);
        who = await authenticate(request, env);
        if (!who.ok) return failResponse(who);
        const parsed = await readJson(request, MAX_PARSE_BODY);
        if (parsed.error) return parsed.error;
        const b = parsed.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return apiError(400, 'invalid_body', 'Expected {"ua": "…"}.');
        if (b.ua != null && typeof b.ua !== 'string') return apiError(400, 'invalid_body', 'ua must be a string.');
        // Empty body / missing ua → parse the request's own User-Agent (useful for "detect mine").
        ua = b.ua != null ? b.ua : (request.headers.get('user-agent') || '');
      } else {
        ua = url.searchParams.has('ua') ? url.searchParams.get('ua') : (request.headers.get('user-agent') || '');
      }
      const v = validateUa(ua);
      if (v.error) return v.error;
      if (!who) {
        who = await authenticate(request, env);
        if (!who.ok) return failResponse(who);
      }
      const r = await runCheck({ input: { ua: v.ua }, auth: who, env, ctx, ip });
      if (!r.ok) return failResponse(r);
      return json(r.body, 200, r.headers);
    }

    if (path === '/v1/bulk') {
      if (method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST with {"uas":[…]}.', { allow: 'POST' });
      if (declaredTooLarge(request, MAX_BULK_BODY)) return apiError(413, 'body_too_large', `Request body must be at most ${MAX_BULK_BODY} bytes.`);
      const who = await authenticate(request, env);
      if (!who.ok) return failResponse(who);
      if (who.kind !== 'key') return apiError(401, 'api_key_required', `Bulk parse needs an API key: Authorization: Bearer ${KEY_PREFIX}…`, { 'www-authenticate': 'Bearer' });
      const parsed = await readJson(request, MAX_BULK_BODY);
      if (parsed.error) return parsed.error;
      const body = parsed.body;
      const uas = body && Array.isArray(body.uas) ? body.uas : null;
      if (!uas) return apiError(400, 'invalid_body', 'Expected {"uas": ["…", …]}.');
      if (uas.length === 0) return apiError(400, 'empty_batch', 'uas must contain at least one User-Agent.');
      if (uas.length > MAX_BATCH) return apiError(400, 'too_many_uas', `At most ${MAX_BATCH} User-Agents per bulk call (got ${uas.length}).`);
      const planMax = Math.min(who.rec.bulkMax, MAX_BATCH);
      if (uas.length > planMax) return apiError(403, 'plan_bulk_limit', `Your ${who.rec.plan} plan allows at most ${planMax} User-Agents per bulk call (got ${uas.length}).${who.rec.plan === 'free' ? ` UAParse Pro ($${PLANS.pro.price_usd}/month) allows up to ${Math.min(PLANS.pro.bulk_max, MAX_BATCH)}: /docs#pricing` : ''}`);
      const badIdx = uas.findIndex((e) => typeof e !== 'string' || !e.trim() || e.length > MAX_UA_LENGTH);
      if (badIdx >= 0) return apiError(400, 'invalid_ua_item', `uas[${badIdx}] must be a non-empty string of at most ${MAX_UA_LENGTH} characters.`);
      const r = await runCheck({ input: { uas }, auth: who, env, ctx, ip });
      if (!r.ok) return failResponse(r);
      return json(r.body, 200, r.headers);
    }

    return apiError(404, 'not_found', 'Unknown API route. See /docs');
  }

  return async function handle(request, env = {}, ctx = {}) {
    let res;
    try {
      res = await route(request, env, ctx);
    } catch {
      res = apiError(500, 'internal_error', 'Something went wrong. Please try again.');
    }
    if (isStaging(env)) {
      res = new Response(res.body, res);
      res.headers.set('x-robots-tag', 'noindex, nofollow');
    }
    return res;
  };
}

// Re-export parseUA for tests that want the uncached path.
export { parseUA };
