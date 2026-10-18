/**
 * UAParse remote MCP server (v0.3.0). Hand-rolled JSON-RPC 2.0 over Streamable HTTP; no SDK, no dependencies. Adapted from
 * DnsGuard v0.7.2 src/lib/mcp.js: the transport below is DnsGuard's, only SERVER_INFO, instructions, TOOLS,
 * callTool()/summarizeParse(), the error-meta prefix and the passed-through headers are UAParse-specific.
 *
 * Dual-era and stateless:
 *  - Modern (MCP 2026-07-28): every request carries params._meta["io.modelcontextprotocol/protocolVersion"] plus the
 *    MCP-Protocol-Version / Mcp-Method / Mcp-Name headers. Methods: server/discover, tools/list, tools/call.
 *  - Legacy (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05): initialize handshake, notifications/initialized, ping,
 *    tools/list, tools/call. JSON-RPC batches (max 10 messages, at most one tools/call) are accepted for legacy clients.
 *  - No sessions: no Mcp-Session-Id is ever issued; one sent by a client is ignored. GET/DELETE → 405 (no SSE stream).
 *  - Responses are always application/json (no SSE).
 *
 * Auth + limits are NOT implemented here: the router passes in authenticate() and runCheck() from app.js, the exact
 * functions behind /v1/parse, so key handling, the result cache and every rate/daily/shared-pool counter are
 * identical. One tools/call = one lookup. initialize / tools/list / ping / server/discover never touch lookup quota;
 * they have a light per-isolate cap per IP bucket (DISCOVERY_PER_MIN; IPv6 → its /64).
 * Bulk parsing stays REST-only (POST /v1/bulk, API key); the bot list is GET /v1/bots (one tool on purpose).
 */
import { VERSION } from './version.js';
import { MAX_UA_LENGTH } from './parse.js';
import { LIST_VERSION, BOT_COUNT, AI_CRAWLER_COUNT, AI_AGENT_KIND_TEXT, AI_PURPOSE_TEXT } from './detect.js';
import { PLANS } from './keys.js';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_BATCH = 10;
export const MAX_CHECKS_PER_REQUEST = 1; // bounds CPU per invocation (cpu_ms = 100) and keeps 1 HTTP request ≈ 1 lookup
export const DISCOVERY_PER_MIN = 120; // per IP bucket per isolate, for non-lookup messages (initialize, tools/list, ping, …)
export const NOT_AFFILIATED = 'UAParse is independent and not affiliated with Meta, OpenAI, Google, Anthropic, Amazon, Perplexity or Mistral AI.';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

// JSON-RPC / MCP error codes
export const E = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603,
  SERVER: -32000, // implementation-defined (auth, rate limit, body too large, forbidden origin)
  HEADER_MISMATCH: -32020, UNSUPPORTED_VERSION: -32022,
};

// Headers a tools/call result passes through from runCheck() (the same ones /v1/parse sends).
export const PASS_HEADERS = ['retry-after', 'x-cache', 'x-quota-limit', 'x-quota-remaining', 'x-quota-reset'];

export const MCP_CORS = {
  // Keys are explicit bearer headers (never ambient cookies), so a wildcard origin without credentials is safe and lets
  // browser-based MCP inspectors work. Same policy as /v1/*. UAParse keys are Authorization: Bearer only (no X-Api-Key).
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS', // GET/DELETE → 405 (no SSE stream, no sessions)
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name',
  'access-control-expose-headers': ['mcp-protocol-version', ...PASS_HEADERS].join(', '),
  'access-control-max-age': '86400',
};

export const SERVER_INFO = { name: 'uaparse', title: 'UAParse', version: VERSION };
export const instructions = (anonPerMin = 20) => `UAParse parses a User-Agent string into browser, engine, OS, device type and CPU, and flags known bots, search crawlers, AI crawlers (with their purpose: training, search, user_fetch or agent) and AI agents acting live for an individual user (is_ai_agent), using a curated list of ${BOT_COUNT} bots (${AI_CRAWLER_COUNT} AI crawlers, list ${LIST_VERSION}). Call parse_user_agent with the exact User-Agent header value (at most ${MAX_UA_LENGTH} characters). A User-Agent is self-reported and can be spoofed, so a match is never verified. AI agents that browse in an ordinary browser and publish no User-Agent token are reported as a normal browser. Results are cached per edge isolate. Anonymous use is limited to about ${anonPerMin} lookups per minute per IP; send "Authorization: Bearer up_live_…" (free API key, issued by email request) or a UAParse Pro license key ("Bearer UAPR-…", $${PLANS.pro.price_usd}/month on Polar, ${PLANS.pro.daily.toLocaleString('en-US')} lookups/day) for higher limits. Bulk parsing (POST /v1/bulk, API key) and the full bot list (GET /v1/bots) are REST-only; see /llms.txt. ${NOT_AFFILIATED}`;

const s = (description) => ({ type: 'string', ...(description ? { description } : {}) });
export const TOOLS = [{
  name: 'parse_user_agent',
  title: 'Parse a User-Agent (browser, OS, device, bot / AI crawler / AI agent)',
  description: `Parse one User-Agent string. Returns browser, engine, OS, device type and CPU (ua-parser-js 1.0.41), and whether it is a known bot, search crawler, AI crawler (with its AI purpose) or an AI agent acting for a user (is_ai_agent, ai_agent_kind fetch | browsing), plus the bot name, operator, robots.txt token and operator docs link from a curated list of ${BOT_COUNT} bots (list ${LIST_VERSION}). verified is always false: the User-Agent is self-reported and UAParse does no IP or reverse-DNS checks. Read-only, no network lookups. Same engine and limits as the UAParse JSON API (POST /v1/parse); each call is one lookup. ${NOT_AFFILIATED}`,
  inputSchema: {
    type: 'object',
    properties: {
      ua: { type: 'string', minLength: 1, maxLength: MAX_UA_LENGTH, description: 'The User-Agent string to parse, exactly as sent in the User-Agent header.' },
      include_raw: { type: 'boolean', default: false, description: 'Also return the full POST /v1/parse JSON in structuredContent.raw. Larger output.' },
    },
    required: ['ua'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ua: s('The parsed User-Agent (clipped to 300 characters; see ua_length)'),
      ua_length: { type: 'integer' },
      browser: { type: 'object', properties: { name: s(), version: s(), major: s() } },
      engine: { type: 'object', properties: { name: s(), version: s() } },
      os: { type: 'object', properties: { name: s(), version: s() } },
      device: { type: 'object', properties: { type: s('desktop, mobile, tablet, smarttv, console, wearable, xr, embedded, bot or unknown'), vendor: s(), model: s() }, required: ['type'] },
      cpu: { type: 'object', properties: { architecture: s() } },
      is_bot: { type: 'boolean' },
      is_ai_crawler: { type: 'boolean' },
      is_ai_agent: { type: 'boolean', description: 'true only for User-Agents the operator documents as acting live for an individual user' },
      is_search_crawler: { type: 'boolean' },
      bot: {
        type: 'object',
        description: 'Present when is_bot is true. Fields that are unknown are omitted.',
        properties: {
          name: s(), operator: s(), category: s(), category_label: s(),
          ai_purpose: { type: 'string', enum: ['training', 'search', 'user_fetch', 'agent'] },
          ai_agent_kind: { type: 'string', enum: ['fetch', 'browsing'] },
          robots_token: s(), token_only: { type: 'boolean' }, info_url: s('Operator documentation'),
          match: { type: 'string', enum: ['list', 'heuristic'] },
          verified: { type: 'boolean', description: 'Always false' },
        },
        required: ['category', 'match', 'verified'],
      },
      summary: s('One-line plain-English verdict'),
      list_version: s(),
      parser: s(),
      cached: { type: 'boolean' },
      tier: { type: 'string', enum: ['anonymous', 'free', 'pro'] },
      version: s(),
      raw: { type: 'object', description: 'Full POST /v1/parse response (only when include_raw is true)' },
    },
    required: ['ua', 'ua_length', 'browser', 'engine', 'os', 'device', 'cpu', 'is_bot', 'is_ai_crawler', 'is_ai_agent', 'is_search_crawler', 'summary', 'list_version', 'version'],
  },
  annotations: { title: 'Parse User-Agent', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}];
const TOOL_ARGS = new Set(Object.keys(TOOLS[0].inputSchema.properties)); // inputSchema says additionalProperties: false; enforced in callTool

const clip = (v, n) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n - 1)}…` : v);
/** Copy the non-null string fields of obj (clipped), so structuredContent never carries null (outputSchema types). */
const strs = (obj, keys, n = 120) => Object.fromEntries(keys.filter((k) => obj && typeof obj[k] === 'string').map((k) => [k, clip(obj[k], n)]));

/** Plain-English verdict, same wording as the web tool's badge. */
export function verdict(r) {
  const b = r.bot || {};
  const who = (fallback) => `${b.name || fallback}${b.operator ? ` (${b.operator})` : ''}`;
  if (r.is_ai_agent) return `AI agent acting for a user: ${who('AI agent')}. ${AI_AGENT_KIND_TEXT[b.ai_agent_kind] || ''}`.trim();
  if (r.is_ai_crawler) return `AI crawler: ${who('AI crawler')}. ${AI_PURPOSE_TEXT[b.ai_purpose] || ''}`.trim();
  if (r.is_search_crawler) return `Search crawler: ${who('Search crawler')}.`;
  if (r.is_bot) return `Bot: ${b.name ? `${b.name} · ` : ''}${b.category_label || 'Bot'}${b.operator ? ` (operator ${b.operator})` : ''}.`;
  return 'Human browser: not on the bot / crawler list.';
}

/** Concise, schema-conforming summary of a full /v1/parse body. Every string is clipped; nulls are omitted. */
export function summarizeParse(body, { tier, cached, includeRaw }) {
  const b = body.bot || {};
  const out = {
    ua: clip(body.ua, 300),
    ua_length: body.ua.length,
    browser: strs(body.browser, ['name', 'version', 'major']),
    engine: strs(body.engine, ['name', 'version']),
    os: strs(body.os, ['name', 'version']),
    device: { type: body.device.type, ...strs(body.device, ['vendor', 'model']) },
    cpu: strs(body.cpu, ['architecture']),
    is_bot: body.is_bot,
    is_ai_crawler: body.is_ai_crawler,
    is_ai_agent: body.is_ai_agent,
    is_search_crawler: body.is_search_crawler,
  };
  if (body.is_bot) {
    out.bot = {
      ...strs(b, ['name', 'operator', 'category', 'category_label', 'ai_purpose', 'ai_agent_kind', 'robots_token']),
      token_only: !!b.token_only,
      ...strs(b, ['info_url'], 300),
      match: b.match,
      verified: false,
    };
  }
  out.summary = clip(verdict(body), 400);
  out.list_version = body.list_version;
  out.parser = body.parser;
  out.cached = !!cached;
  out.tier = tier || 'anonymous';
  out.version = VERSION;
  if (includeRaw) out.raw = body;
  return out;
}

/** Human/LLM-readable text version of the summary (also the content[0] block). */
export function summaryText(sum) {
  const join = (o, keys) => keys.map((k) => o[k]).filter(Boolean).join(' ');
  const lines = [`UAParse: ${sum.summary}`,
    `Browser: ${join(sum.browser, ['name', 'version']) || '—'} · OS: ${join(sum.os, ['name', 'version']) || '—'} · Device: ${sum.device.type} · Engine: ${join(sum.engine, ['name', 'version']) || '—'}`,
    `Flags: is_bot=${sum.is_bot}, is_ai_crawler=${sum.is_ai_crawler}, is_ai_agent=${sum.is_ai_agent}, is_search_crawler=${sum.is_search_crawler}`];
  if (sum.bot && sum.bot.robots_token) lines.push(`robots.txt token: ${sum.bot.robots_token}${sum.bot.token_only ? ' (documented as a robots.txt token only)' : ''}`);
  if (sum.bot && sum.bot.info_url) lines.push(`Operator docs: ${sum.bot.info_url}`);
  if (sum.is_bot) lines.push('Not verified: a User-Agent is self-reported and can be spoofed.');
  lines.push(`List ${sum.list_version} · ${sum.parser}`);
  if (sum.bot && sum.bot.operator) lines.push(NOT_AFFILIATED);
  return lines.join('\n');
}

function toolError(message, data, extra = {}) {
  return { content: [{ type: 'text', text: message }], isError: true, ...(data ? { _meta: { 'uaparse/error': data } } : {}), ...extra };
}

/** tools/call for parse_user_agent. Returns { result } or { error } (protocol error), plus HTTP headers to surface. */
async function callTool(params, deps, auth) {
  const { name } = params;
  const args = params.arguments === undefined ? {} : params.arguments;
  if (name !== TOOLS[0].name) return { error: { code: E.INVALID_PARAMS, message: `Unknown tool: ${clip(String(name), 80)}` } };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: { code: E.INVALID_PARAMS, message: 'arguments must be an object' } };
  // Input problems are tool-execution errors (isError) so the model can correct itself. No lookup is counted.
  const unknown = Object.keys(args).filter((k) => !TOOL_ARGS.has(k));
  if (unknown.length) {
    return { result: toolError(`Unknown argument(s): ${clip(unknown.slice(0, 5).join(', '), 80)}. Allowed: ${[...TOOL_ARGS].join(', ')}.`, { code: 'invalid_arguments', httpStatus: 400 }) };
  }
  // Same rules and codes as the REST validator (src/app.js validateUa).
  const { ua } = args;
  if (typeof ua !== 'string') return { result: toolError('ua is required: pass the User-Agent string to parse.', { code: 'missing_ua', httpStatus: 400 }) };
  if (!ua.trim()) return { result: toolError('ua must not be empty.', { code: 'empty_ua', httpStatus: 400 }) };
  if (ua.length > MAX_UA_LENGTH) return { result: toolError(`ua must be at most ${MAX_UA_LENGTH} characters.`, { code: 'ua_too_long', httpStatus: 400 }) };
  if (args.include_raw !== undefined && typeof args.include_raw !== 'boolean') {
    return { result: toolError('include_raw must be a boolean.', { code: 'invalid_arguments', httpStatus: 400 }) };
  }
  const r = await deps.runCheck({ input: { ua }, auth, env: deps.env, ctx: deps.ctx, ip: deps.ip });
  const headers = { ...(r.headers || {}) };
  if (!r.ok) {
    const retry = r.headers && r.headers['retry-after'] ? Number(r.headers['retry-after']) : undefined;
    const msg = `${r.message}${retry ? ` (retry after ${retry} seconds)` : ''}`;
    return { result: toolError(msg, { code: r.code, httpStatus: r.status, ...(retry ? { retryAfterSeconds: retry } : {}) }), headers };
  }
  const tier = auth.kind === 'key' ? auth.rec.plan : 'anonymous';
  const summary = summarizeParse(r.body, { tier, cached: r.cached, includeRaw: args.include_raw === true });
  return { result: { content: [{ type: 'text', text: summaryText(summary) }], structuredContent: summary, isError: false }, headers };
}

// ---------- transport helpers ----------

/** Origin policy: absent = OK (CLI / server-side clients). Present: must be a bare https origin or an http loopback
 * origin, or (if MCP_ALLOWED_ORIGINS is set) same-origin / listed. Malformed, "null" and plain-http remote → 403. */
export function originAllowed(origin, selfOrigin, allowList) {
  if (origin === null || origin === undefined) return true;
  if (origin === selfOrigin) return true;
  if (allowList) return String(allowList).split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.origin !== origin) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

async function readCapped(request, cap) {
  const cl = Number(request.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > cap) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(buf);
}

function decodeHeaderValue(v) {
  if (v == null) return v;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0))); } catch { return null; }
}

const isId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/**
 * Handle one JSON-RPC message. Returns { response?, status?, headers?, isCheck? }.
 * `response` undefined = notification accepted (202 when it's the whole request).
 */
async function handleMessage(msg, { modern, request, deps, auth, checkBudget }) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { response: rpcError(null, E.INVALID_REQUEST, 'Invalid Request'), status: 400 };
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  if (msg.jsonrpc !== '2.0') return { response: rpcError(hasId && isId(msg.id) ? msg.id : null, E.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"'), status: 400 };
  if (typeof msg.method !== 'string') {
    // A JSON-RPC response or garbage. Legacy clients may POST responses → accept like a notification.
    if (!modern && hasId && ('result' in msg || 'error' in msg)) return {};
    return { response: rpcError(hasId && isId(msg.id) ? msg.id : null, E.INVALID_REQUEST, 'Invalid Request: method is required'), status: 400 };
  }
  if (!hasId) return {}; // notification (notifications/initialized, cancelled, …): accepted, nothing to do
  if (!isId(msg.id)) return { response: rpcError(null, E.INVALID_REQUEST, 'Invalid Request: id must be a string or number'), status: 400 };
  const { id, method } = msg;
  const params = msg.params === undefined ? {} : msg.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { response: rpcError(id, E.INVALID_PARAMS, 'params must be an object') };

  // Modern results carry serverInfo in _meta; merge so a tool error's _meta["uaparse/error"] is kept.
  const done = (result) => ({ response: rpcResult(id, modern ? { resultType: 'complete', ...result, _meta: { ...(result._meta || {}), [META_SERVER]: SERVER_INFO } } : result) });
  const notFound = () => ({ response: rpcError(id, E.METHOD_NOT_FOUND, `Method not found: ${clip(method, 80)}`), status: modern ? 404 : 200 });

  if (modern) {
    // MCP 2026-07-28 per-request validation (version, capabilities, mirrored headers).
    const hName = decodeHeaderValue(request.headers.get('mcp-name'));
    if (request.headers.get('mcp-method') !== method) return { response: rpcError(id, E.HEADER_MISMATCH, 'Header mismatch: Mcp-Method header is missing or does not match the body method'), status: 400 };
    if (!params._meta || typeof params._meta[META_CAPS] !== 'object' || params._meta[META_CAPS] === null) {
      return { response: rpcError(id, E.INVALID_PARAMS, `Missing required _meta field ${META_CAPS}`), status: 400 };
    }
    if (method === 'tools/call' && hName !== params.name) return { response: rpcError(id, E.HEADER_MISMATCH, 'Header mismatch: Mcp-Name header is missing or does not match params.name'), status: 400 };
    if (method === 'server/discover') {
      return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, instructions: instructions(deps.anonPerMin), ttlMs: 3_600_000, cacheScope: 'public' });
    }
    if (method === 'tools/list') return done({ tools: TOOLS, ttlMs: 3_600_000, cacheScope: 'public' });
    if (method !== 'tools/call') return notFound(); // includes initialize and ping (removed in 2026-07-28)
  } else {
    if (method === 'initialize') {
      const req = params.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.includes(req) ? req : LEGACY_VERSIONS[0];
      return done({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructions(deps.anonPerMin) });
    }
    if (method === 'ping') return done({});
    if (method === 'tools/list') return done({ tools: TOOLS });
    if (method === 'server/discover') return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructions(deps.anonPerMin) });
    if (method !== 'tools/call') return notFound();
  }

  // tools/call
  if (typeof params.name !== 'string') return { response: rpcError(id, E.INVALID_PARAMS, 'params.name (tool name) is required') };
  if (checkBudget.used >= MAX_CHECKS_PER_REQUEST) {
    return { response: rpcError(id, E.INVALID_REQUEST, `At most ${MAX_CHECKS_PER_REQUEST} tools/call per HTTP request; send each call as its own request.`) };
  }
  checkBudget.used++;
  const r = await callTool(params, deps, auth);
  if (r.error) return { response: rpcError(id, r.error.code, r.error.message), isCheck: true };
  return { ...done(r.result), headers: r.headers, isCheck: true };
}

/** Entry point from the router for every request to /mcp. */
export async function handleMcp(request, env, ctx, deps) {
  const base = { ...deps.cors, ...deps.security };
  const reply = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }), 'cache-control': 'no-store', ...base, ...extra },
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...deps.cors, ...deps.security } });
  if (!originAllowed(request.headers.get('origin'), deps.origin, deps.allowedOrigins)) {
    return reply(403, rpcError(null, E.SERVER, 'Forbidden: Origin not allowed'));
  }
  if (request.method !== 'POST') {
    return reply(405, rpcError(null, E.SERVER, 'Method not allowed. This MCP endpoint is stateless: POST JSON-RPC messages (no SSE stream, no sessions). Docs: /llms.txt'), { allow: 'POST, OPTIONS' });
  }
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return reply(413, rpcError(null, E.INVALID_REQUEST, `Request body too large (max ${MAX_BODY_BYTES} bytes)`));
  let payload;
  try { payload = JSON.parse(text); } catch { return reply(400, rpcError(null, E.PARSE, 'Parse error: body must be valid JSON')); }

  // Era detection. Modern = per-request _meta version or a modern MCP-Protocol-Version header.
  const hVer = request.headers.get('mcp-protocol-version');
  const single = !Array.isArray(payload);
  const metaVer = single && payload && typeof payload === 'object' && payload.params && typeof payload.params === 'object'
    && payload.params._meta && typeof payload.params._meta === 'object' ? payload.params._meta[META_VERSION] : undefined;
  const modern = metaVer !== undefined || MODERN_VERSIONS.includes(hVer);
  const idOf = (p) => (p && typeof p === 'object' && isId(p.id) ? p.id : null);
  if (modern) {
    if (!single) return reply(400, rpcError(null, E.INVALID_REQUEST, 'JSON-RPC batches are not supported in protocol 2026-07-28; send one message per POST'));
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'id')) {
      if (metaVer === undefined && typeof payload.method === 'string') {
        return reply(400, rpcError(idOf(payload), E.INVALID_PARAMS, `Missing required _meta field ${META_VERSION}`));
      }
      if (metaVer !== undefined && !SUPPORTED_VERSIONS.includes(metaVer)) {
        return reply(400, rpcError(idOf(payload), E.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: clip(String(metaVer), 40) }));
      }
      if (metaVer !== undefined && !MODERN_VERSIONS.includes(metaVer)) {
        return reply(400, rpcError(idOf(payload), E.UNSUPPORTED_VERSION, `Protocol version ${metaVer} uses the initialize handshake; per-request _meta requires one of: ${MODERN_VERSIONS.join(', ')}`, { supported: SUPPORTED_VERSIONS, requested: metaVer }));
      }
      if (hVer !== metaVer) return reply(400, rpcError(idOf(payload), E.HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version header is missing or does not match _meta protocolVersion'));
    }
  } else if (hVer && !LEGACY_VERSIONS.includes(hVer)) {
    return reply(400, rpcError(single ? idOf(payload) : null, E.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: clip(hVer, 40) }));
  }

  const msgs = single ? [payload] : payload;
  if (!msgs.length) return reply(400, rpcError(null, E.INVALID_REQUEST, 'Invalid Request: empty batch'));
  if (msgs.length > MAX_BATCH) return reply(400, rpcError(null, E.INVALID_REQUEST, `Batch too large (max ${MAX_BATCH} messages)`));

  // Light per-IP-bucket cap on non-lookup messages (lookups are governed by the /v1/parse limits inside runCheck).
  // Keyed on ipBucket (IPv6 → its /64) so one subscriber can't rotate addresses inside their prefix to dodge it.
  const nonCheck = msgs.filter((m) => !(m && m.method === 'tools/call')).length;
  for (let i = 0; i < nonCheck; i++) {
    if (!deps.memLimit(`mcp:${deps.ipBucket || deps.ip}`, DISCOVERY_PER_MIN, 60_000)) {
      return reply(429, rpcError(single ? idOf(payload) : null, E.SERVER, `Too many MCP requests from your IP (about ${DISCOVERY_PER_MIN} per minute). Retry in a minute.`, { code: 'rate_limited', retryAfterSeconds: 60 }), { 'retry-after': '60' });
    }
  }

  // Same key gate as /v1/parse, evaluated once per HTTP request (bad key → 401 for every method).
  const auth = await deps.authenticate(request, env);
  if (!auth.ok) {
    // No WWW-Authenticate on /mcp: MCP clients treat a 401 Bearer challenge as "start OAuth discovery", which this
    // server doesn't offer; the JSON-RPC error body (data.code = invalid_api_key) is the useful signal. The REST
    // routes keep their `WWW-Authenticate: Bearer` (unchanged contract), so it is stripped here.
    const extra = Object.fromEntries(Object.entries(auth.headers || {}).filter(([h]) => h.toLowerCase() !== 'www-authenticate'));
    return reply(auth.status, rpcError(single ? idOf(payload) : null, E.SERVER, auth.message, { code: auth.code, httpStatus: auth.status }), extra);
  }

  const mdeps = { ...deps, env, ctx };
  const checkBudget = { used: 0 };
  const responses = [];
  let status = 200;
  let headers = {};
  for (const m of msgs) {
    let out;
    try {
      out = await handleMessage(m, { modern, request, deps: mdeps, auth, checkBudget });
    } catch {
      out = { response: rpcError(idOf(m), E.INTERNAL, 'Internal error') };
    }
    if (out.response) responses.push(out.response);
    if (single) status = out.status || 200;
    if (out.headers) headers = out.headers; // at most one tools/call per request, so batches pass its headers too
  }
  if (!responses.length) return reply(202, null);
  const exposed = {};
  for (const h of PASS_HEADERS) if (headers[h]) exposed[h] = headers[h];
  return reply(status, single ? responses[0] : responses, exposed);
}
