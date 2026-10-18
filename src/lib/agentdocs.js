/**
 * Agent-discovery documents (since v0.3.0): /llms.txt (llmstxt.org format) and /openapi.json (OpenAPI 3.1). Generated
 * from code constants and limitsFor(env) so limits / versions / URLs can't drift from what the Worker enforces. Pattern:
 * DnsGuard v0.7.2 src/lib/agentdocs.js. wherever Muse or AI operators are named, carry NOT_AFFILIATED.
 */
import { VERSION } from './version.js';
import { MAX_UA_LENGTH, PARSER } from './parse.js';
import { PLANS, KEY_PREFIX } from './keys.js';
import { PRO_CHECKOUT_URL, PRO_KEY_PREFIX } from './pro.js';
import { LIST_VERSION, BOT_COUNT, AI_CRAWLER_COUNT, AI_AGENT_COUNT, AI_AGENT_CURRENT_COUNT, AI_AGENT_RETIRED } from './detect.js';
import { TOOLS, SUPPORTED_VERSIONS, MAX_BODY_BYTES, MAX_BATCH as MCP_MAX_BATCH, DISCOVERY_PER_MIN, NOT_AFFILIATED } from './mcp.js';

const fmt = (n) => n.toLocaleString('en-US');

export function mcpClientConfig(origin) {
  return { mcpServers: { uaparse: { type: 'http', url: `${origin}/mcp` } } };
}

/** C = { MAX_PARSE_BODY, MAX_BULK_BODY, MAX_BATCH, CONTACT, ROBOTSGATE_URL } from app.js (passed in to avoid an import cycle). */
export function llmsTxt(origin, L, C) {
  const tool = TOOLS[0];
  const retired = AI_AGENT_RETIRED.length ? ` (${AI_AGENT_CURRENT_COUNT} current plus the retired ${AI_AGENT_RETIRED.join(', ')} name, still detected)` : '';
  return `# UAParse

> Free User-Agent parser and bot detector: browser, OS, device type and engine, plus flags for known bots, search crawlers, AI crawlers and AI agents acting for a user. Public JSON API plus a remote MCP server for AI agents.

UAParse runs entirely inside a Cloudflare Worker: ${PARSER} (MIT) for browser / engine / OS / device / CPU, and a curated list of ${BOT_COUNT} bots (${AI_CRAWLER_COUNT} of them AI crawlers, list ${LIST_VERSION}) for bot detection. It makes no network lookups per request, so a match is never "verified": anyone can spoof a User-Agent. It does not store User-Agent strings next to IP addresses.

\`is_ai_agent\` is true only for User-Agents that the operator's own docs describe as acting live for an individual user of an AI assistant or agent: ${AI_AGENT_COUNT} names${retired}. AI agents that browse in a real browser and publish no token (e.g. Meta Muse; Meta publishes no Muse User-Agent) are indistinguishable from people here. ${NOT_AFFILIATED}

## For AI agents

- [MCP server](${origin}/mcp): remote MCP over Streamable HTTP at \`${origin}/mcp\` (POST only, stateless, JSON responses, no sessions). Protocol versions: ${SUPPORTED_VERSIONS.join(', ')} (2026-07-28 per-request \`_meta\`; older versions use \`initialize\`). One tool: \`${tool.name}\` with \`ua\` (required, 1–${fmt(MAX_UA_LENGTH)} characters) and \`include_raw\` (optional). Read-only. Client config (most MCP clients accept this; some use a different format, for example VS Code uses a \`servers\` key): \`${JSON.stringify(mcpClientConfig(origin))}\`
- [OpenAPI 3.1 spec](${origin}/openapi.json): machine-readable description of the JSON API
- [JSON API docs](${origin}/docs): human-readable API reference with examples

## JSON API

- \`POST ${origin}/v1/parse\` with \`{"ua":"…"}\` (recommended; JSON body at most ${fmt(C.MAX_PARSE_BODY)} bytes) or \`GET ${origin}/v1/parse?ua=…\`. Without \`ua\` it parses the caller's own User-Agent. Returns \`ua\`, \`browser\`, \`engine\`, \`os\`, \`device\` (\`type\`: desktop, mobile, tablet, smarttv, console, wearable, xr, embedded, bot or unknown), \`cpu\`, \`is_bot\`, \`is_ai_crawler\`, \`is_ai_agent\`, \`is_search_crawler\`, \`bot\` (\`category\`, \`name\`, \`operator\`, \`ai_purpose\`, \`ai_agent_kind\`, \`robots_token\`, \`token_only\`, \`info_url\`, \`match\`, \`verified\` = false), \`list_version\`, \`parser\`. Header \`X-Cache: HIT|MISS\`. CORS enabled.
- \`POST ${origin}/v1/bulk\` with \`{"uas":["…", …]}\`: API key required; at most ${C.MAX_BATCH} User-Agents per call (free keys ${PLANS.free.bulk_max}, Pro ${Math.min(PLANS.pro.bulk_max, C.MAX_BATCH)}); body at most ${fmt(C.MAX_BULK_BODY)} bytes; each UA is one lookup; all-or-nothing. Returns \`{"count", "list_version", "results": [...]}\`. REST only (not an MCP tool).
- \`GET ${origin}/v1/bots\`: the curated bot list (not counted as lookups).
- \`GET ${origin}/v1/meta\`: version, list version, counts and limits.
- \`GET ${origin}/health\`: \`{ "ok": true, "service": "uaparse", "version": "${VERSION}", "build": "…" }\`
- Errors: \`{ "error": { "code", "message" } }\` with HTTP 400 \`empty_ua\`/\`ua_too_long\`/\`invalid_body\`/\`invalid_json\`/\`empty_batch\`/\`too_many_uas\`/\`invalid_ua_item\`, 401 \`invalid_api_key\`/\`api_key_required\`, 403 \`plan_bulk_limit\`, 405 \`method_not_allowed\`, 413 \`body_too_large\`, 415 \`unsupported_media_type\`, 429 \`rate_limited\`/\`quota_exceeded\`/\`daily_capacity_reached\`/\`too_many_failed_auth\` (see \`Retry-After\`), 503 \`keys_unavailable\`/\`storage_unavailable\`/\`quota_unavailable\`.

## Limits, keys and pricing

- Anonymous (no key; web tool, API and MCP): about ${L.anonPerMin} lookups per minute per IP (IPv6: per /64 prefix); all anonymous users share about ${fmt(L.anonPerDay)} lookups per UTC day.
- Free API key (issued by email request during early access: ${C.CONTACT}): ${fmt(PLANS.free.daily)} lookups per UTC day, about ${L.keyPerMin} requests per minute, bulk up to ${PLANS.free.bulk_max} per call. Send \`Authorization: Bearer ${KEY_PREFIX}…\`.
- UAParse Pro: $${PLANS.pro.price_usd}/month, cancel anytime, bought on Polar: ${PRO_CHECKOUT_URL} . ${fmt(PLANS.pro.daily)} lookups per UTC day, about ${L.keyPerMin} requests per minute, bulk up to ${Math.min(PLANS.pro.bulk_max, C.MAX_BATCH)} per call, not subject to the shared daily capacity. Polar emails a license key; send \`Authorization: Bearer ${PRO_KEY_PREFIX}-…\` (API and MCP). An inactive or expired license returns HTTP 401 \`invalid_api_key\`.
- Anonymous and free keys: a shared daily capacity of about ${fmt(L.checksPerDay)} lookups; when it is reached, HTTP 429 \`daily_capacity_reached\` until 00:00 UTC.
- The MCP endpoint uses the same keys and the same counters: each \`tools/call\` is one lookup (cache hits included, like the API). \`initialize\`, \`tools/list\` and other non-lookup messages don't count as lookups, but have a light cap of about ${DISCOVERY_PER_MIN} per minute per IP (over it: HTTP 429 with \`Retry-After\`). Over a limit, the tool result has \`isError: true\` with the reason and \`retryAfterSeconds\`. An invalid key returns HTTP 401.
- MCP request caps: ${fmt(MAX_BODY_BYTES)}-byte body, JSON-RPC batches (legacy versions only) of at most ${MCP_MAX_BATCH} messages with at most one \`tools/call\`.

## Optional

- [Homepage and web tool](${origin}/)
- [Privacy](${origin}/privacy)
- [RobotsGate](${C.ROBOTSGATE_URL}): sibling tool for robots.txt rules for AI crawlers (UAParse does not build robots.txt)
- Contact: ${C.CONTACT}
`;
}

const errorSchema = { $ref: '#/components/schemas/Error' };
const errResp = (description, extraHeaders) => ({
  description,
  ...(extraHeaders ? { headers: extraHeaders } : {}),
  content: { 'application/json': { schema: errorSchema } },
});
const mcpNotAllowed = (m) => ({
  tags: ['mcp'],
  operationId: `mcp_${m}_not_allowed`,
  summary: 'Not supported (stateless server: no SSE stream, no sessions)',
  responses: {
    405: { description: 'Always 405 with `Allow: POST, OPTIONS` and a JSON-RPC error body', headers: { Allow: { schema: { type: 'string', const: 'POST, OPTIONS' } } }, content: { 'application/json': { schema: { type: 'object' } } } },
  },
});
const retryAfter = { 'Retry-After': { description: 'Seconds to wait before retrying', schema: { type: 'integer' } } };
const nstr = { type: ['string', 'null'] };

export function openApiSpec(origin, L, C) {
  const quotaHeaders = {
    'x-quota-limit': { description: 'Keyed requests: the key\'s daily lookup quota (UTC day)', schema: { type: 'integer' } },
    'x-quota-remaining': { description: 'Keyed requests: lookups left today', schema: { type: 'integer' } },
    'x-quota-reset': { description: 'Keyed requests: when the daily quota resets (next 00:00 UTC, ISO 8601)', schema: { type: 'string', format: 'date-time' } },
  };
  const parseHeaders = { 'x-cache': { description: '`HIT` or `MISS` in the per-isolate result cache (a hit still counts as a lookup)', schema: { type: 'string', enum: ['HIT', 'MISS'] } }, ...quotaHeaders };
  const r429 = errResp('`rate_limited` (per-minute), `quota_exceeded` (the key\'s daily quota; quota headers included), `daily_capacity_reached` (shared daily capacity) or `too_many_failed_auth` (repeated invalid keys from this IP)', { ...retryAfter, ...quotaHeaders });
  const r401 = (bulk) => errResp(bulk ? '`invalid_api_key` (unknown or malformed key) or `api_key_required` (no key sent)' : '`invalid_api_key`: an Authorization header was sent but the key is unknown or malformed', { 'WWW-Authenticate': { schema: { type: 'string', const: 'Bearer' } } });
  const r503 = errResp('`keys_unavailable`, `storage_unavailable` or `quota_unavailable` (temporary)', retryAfter);
  const r500 = errResp('`internal_error`');
  const security = [{}, { bearerAuth: [] }];
  const okParse = { description: 'Parse result', headers: parseHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/ParseResult' } } } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'UAParse API',
      version: VERSION,
      summary: 'User-Agent parsing plus bot, search crawler, AI crawler and AI agent detection.',
      description: `Free JSON API behind ${origin}. No key needed for light use (about ${L.anonPerMin} lookups/min per IP; IPv6 per /64; anonymous users share about ${fmt(L.anonPerDay)} lookups per UTC day). A free API key (by email request: ${C.CONTACT}) allows ${fmt(PLANS.free.daily)} lookups per UTC day and about ${L.keyPerMin} requests/min. Every lookup counts, including result-cache hits. There are no X-RateLimit-* headers; a 429 carries Retry-After. User-Agents are self-reported, so \`bot.verified\` is always false. AI agents can also use the remote MCP server at ${origin}/mcp (see /llms.txt). ${NOT_AFFILIATED}`,
      contact: { name: 'UAParse', email: C.CONTACT, url: origin },
    },
    servers: [{ url: origin }],
    externalDocs: { description: 'Human-readable API docs', url: `${origin}/docs` },
    tags: [{ name: 'parse' }, { name: 'meta' }, { name: 'mcp' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: `Free API key (\`${KEY_PREFIX}\` + 64 hex) or UAParse Pro license key (\`${PRO_KEY_PREFIX}-…\`, from Polar checkout). Optional for /v1/parse and /mcp, required for /v1/bulk. Authorization: Bearer is the only accepted key header.` },
      },
      schemas: {
        Error: {
          type: 'object', required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        Bot: {
          type: 'object',
          required: ['is_bot', 'is_ai_crawler', 'is_ai_agent', 'is_search_crawler', 'category', 'category_label', 'name', 'operator', 'ai_purpose', 'ai_agent_kind', 'robots_token', 'token_only', 'info_url', 'match', 'verified'],
          properties: {
            is_bot: { type: 'boolean' }, is_ai_crawler: { type: 'boolean' }, is_ai_agent: { type: 'boolean' }, is_search_crawler: { type: 'boolean' },
            category: { type: ['string', 'null'], description: 'ai_crawler, search_crawler, ads_crawler, seo_crawler, social_preview, feed_reader, monitoring, archiver, security_scanner, headless_browser, http_client, other_crawler, unknown_bot' },
            category_label: nstr, name: nstr, operator: nstr,
            ai_purpose: { type: ['string', 'null'], enum: ['training', 'search', 'user_fetch', 'agent', null] },
            ai_agent_kind: { type: ['string', 'null'], enum: ['fetch', 'browsing', null] },
            robots_token: nstr, token_only: { type: 'boolean' }, info_url: nstr,
            match: { type: ['string', 'null'], enum: ['list', 'heuristic', null] },
            verified: { type: 'boolean', const: false },
          },
        },
        ParseResult: {
          type: 'object',
          required: ['ua', 'browser', 'engine', 'os', 'device', 'cpu', 'is_bot', 'is_ai_crawler', 'is_ai_agent', 'is_search_crawler', 'bot', 'list_version', 'parser'],
          properties: {
            ua: { type: 'string', maxLength: MAX_UA_LENGTH },
            browser: { type: 'object', required: ['name', 'version', 'major'], properties: { name: nstr, version: nstr, major: nstr } },
            engine: { type: 'object', required: ['name', 'version'], properties: { name: nstr, version: nstr } },
            os: { type: 'object', required: ['name', 'version'], properties: { name: nstr, version: nstr } },
            device: { type: 'object', required: ['type', 'vendor', 'model'], properties: { type: { type: 'string', enum: ['desktop', 'mobile', 'tablet', 'smarttv', 'console', 'wearable', 'xr', 'embedded', 'bot', 'unknown'] }, vendor: nstr, model: nstr } },
            cpu: { type: 'object', required: ['architecture'], properties: { architecture: nstr } },
            is_bot: { type: 'boolean' }, is_ai_crawler: { type: 'boolean' }, is_ai_agent: { type: 'boolean' }, is_search_crawler: { type: 'boolean' },
            bot: { $ref: '#/components/schemas/Bot' },
            list_version: { type: 'string', examples: [LIST_VERSION] },
            parser: { type: 'string', examples: [PARSER] },
          },
        },
        JsonRpcMessage: {
          type: 'object', required: ['jsonrpc'],
          properties: { jsonrpc: { const: '2.0' }, id: { type: ['string', 'integer'] }, method: { type: 'string' }, params: { type: 'object' } },
        },
      },
    },
    paths: {
      '/v1/parse': {
        get: {
          tags: ['parse'], operationId: 'parseGet', summary: 'Parse one User-Agent (query string)', security,
          parameters: [{ name: 'ua', in: 'query', required: false, description: `User-Agent to parse (1–${fmt(MAX_UA_LENGTH)} characters, not only spaces). Omit to parse the request's own User-Agent header.`, schema: { type: 'string', minLength: 1, maxLength: MAX_UA_LENGTH } }],
          responses: {
            200: okParse,
            400: errResp('`empty_ua` or `ua_too_long`'),
            401: r401(false),
            405: errResp('`method_not_allowed`: use GET or POST', { Allow: { schema: { type: 'string', const: 'GET, POST' } } }),
            429: r429, 500: r500, 503: r503,
          },
        },
        post: {
          tags: ['parse'], operationId: 'parsePost', summary: 'Parse one User-Agent (JSON body; recommended)', security,
          requestBody: {
            required: false,
            description: `JSON, at most ${fmt(C.MAX_PARSE_BODY)} bytes. Omit \`ua\` (e.g. \`{}\`) to parse the request's own User-Agent header.`,
            content: { 'application/json': { schema: { type: 'object', properties: { ua: { type: 'string', minLength: 1, maxLength: MAX_UA_LENGTH } } } } },
          },
          responses: {
            200: okParse,
            400: errResp('`empty_ua`, `ua_too_long`, `invalid_body` (not an object / ua not a string / not UTF-8) or `invalid_json`'),
            401: r401(false),
            413: errResp('`body_too_large`'),
            415: errResp('`unsupported_media_type`: send Content-Type: application/json'),
            429: r429, 500: r500, 503: r503,
          },
        },
      },
      '/v1/bulk': {
        post: {
          tags: ['parse'], operationId: 'parseBulk', summary: 'Parse a batch of User-Agents (API key)', security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            description: `JSON, at most ${fmt(C.MAX_BULK_BODY)} bytes; at most ${C.MAX_BATCH} User-Agents (free keys ${PLANS.free.bulk_max}). Each UA is one lookup; all-or-nothing.`,
            content: { 'application/json': { schema: { type: 'object', required: ['uas'], properties: { uas: { type: 'array', minItems: 1, maxItems: C.MAX_BATCH, items: { type: 'string', minLength: 1, maxLength: MAX_UA_LENGTH } } } } } },
          },
          responses: {
            200: {
              description: 'Results in input order', headers: quotaHeaders,
              content: { 'application/json': { schema: { type: 'object', required: ['count', 'list_version', 'results'], properties: { count: { type: 'integer' }, list_version: { type: 'string' }, results: { type: 'array', items: { $ref: '#/components/schemas/ParseResult' } } } } } },
            },
            400: errResp('`invalid_body`, `invalid_json`, `empty_batch`, `too_many_uas` or `invalid_ua_item`'),
            401: r401(true),
            403: errResp('`plan_bulk_limit`: more UAs than the key\'s plan allows per call'),
            405: errResp('`method_not_allowed`: use POST', { Allow: { schema: { type: 'string', const: 'POST' } } }),
            413: errResp('`body_too_large`'),
            415: errResp('`unsupported_media_type`: send Content-Type: application/json'),
            429: r429, 500: r500, 503: r503,
          },
        },
      },
      '/v1/bots': {
        get: {
          tags: ['meta'], operationId: 'listBots', summary: 'The curated bot list (not counted as lookups)', security: [{}],
          responses: {
            200: {
              description: 'Bot list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object', required: ['list_version', 'count', 'bots'],
                    properties: {
                      list_version: { type: 'string' }, count: { type: 'integer' },
                      bots: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['name', 'category', 'operator', 'ai_purpose', 'is_ai_agent', 'ai_agent_kind', 'robots_token', 'token_only', 'info_url', 'verified'],
                          properties: { name: { type: 'string' }, category: { type: 'string' }, operator: nstr, ai_purpose: nstr, is_ai_agent: { type: 'boolean' }, ai_agent_kind: nstr, robots_token: { type: 'string' }, token_only: { type: 'boolean' }, info_url: nstr, verified: { type: 'boolean', const: false } },
                        },
                      },
                    },
                  },
                },
              },
            },
            405: errResp('`method_not_allowed`: use GET'),
          },
        },
      },
      '/v1/meta': {
        get: {
          tags: ['meta'], operationId: 'meta', summary: 'Version, list version, counts and limits', security: [{}],
          responses: {
            200: {
              description: 'Metadata',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['service', 'version', 'build', 'list_version', 'bot_count', 'ai_crawler_count', 'ai_agent_count', 'parser', 'limits', 'pro'],
                    properties: {
                      service: { const: 'uaparse' }, version: { type: 'string', examples: [VERSION] }, build: { type: 'string' }, list_version: { type: 'string' },
                      bot_count: { type: 'integer' }, ai_crawler_count: { type: 'integer' }, ai_agent_count: { type: 'integer' }, parser: { type: 'string' },
                      limits: {
                        type: 'object',
                        required: ['anonymous_per_min', 'key_per_min', 'batch_max', 'max_parse_body_bytes', 'max_bulk_body_bytes', 'max_ua_length', 'plans'],
                        properties: {
                          anonymous_per_min: { type: 'integer' }, key_per_min: { type: 'integer' }, batch_max: { type: 'integer' },
                          max_parse_body_bytes: { type: 'integer' }, max_bulk_body_bytes: { type: 'integer' }, max_ua_length: { type: 'integer' },
                          plans: { type: 'object', additionalProperties: { type: 'object', properties: { lookups_per_day: { type: 'integer' }, bulk_max: { type: 'integer' } } } },
                        },
                      },
                      pro: {
                        type: 'object',
                        required: ['price_usd_per_month', 'checkout_url', 'key_prefix', 'portal_url'],
                        properties: { price_usd_per_month: { type: 'number' }, checkout_url: { type: 'string', format: 'uri' }, key_prefix: { type: 'string' }, portal_url: { type: 'string', format: 'uri' } },
                      },
                    },
                  },
                },
              },
            },
            405: errResp('`method_not_allowed`: use GET'),
          },
        },
      },
      '/health': {
        get: {
          tags: ['meta'], operationId: 'health', summary: 'Liveness, deployed version and build', security: [{}],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'service', 'version', 'build'], properties: { ok: { const: true }, service: { const: 'uaparse' }, version: { type: 'string', examples: [VERSION] }, build: { type: 'string' } } } } } } },
        },
      },
      '/mcp': {
        post: {
          tags: ['mcp'],
          operationId: 'mcp',
          summary: 'Remote MCP server (Streamable HTTP, JSON-RPC 2.0)',
          description: `Model Context Protocol endpoint. Stateless, JSON responses only (no SSE, no Mcp-Session-Id). Supported protocol versions: ${SUPPORTED_VERSIONS.join(', ')}. Modern (2026-07-28) requests carry params._meta and the MCP-Protocol-Version, Mcp-Method and Mcp-Name headers; legacy clients use initialize. Tool: ${TOOLS[0].name}. Same keys and limits as /v1/parse; each tools/call counts as one lookup. Body max ${MAX_BODY_BYTES} bytes; legacy batches max ${MCP_MAX_BATCH} messages with at most one tools/call.`,
          security,
          parameters: [
            { name: 'MCP-Protocol-Version', in: 'header', required: false, schema: { type: 'string', enum: SUPPORTED_VERSIONS } },
            { name: 'Mcp-Method', in: 'header', required: false, description: 'Required for 2026-07-28; must equal the body method', schema: { type: 'string' } },
            { name: 'Mcp-Name', in: 'header', required: false, description: 'Required for 2026-07-28 tools/call; must equal params.name', schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/JsonRpcMessage' }, { type: 'array', maxItems: MCP_MAX_BATCH, items: { $ref: '#/components/schemas/JsonRpcMessage' } }] } } },
          },
          responses: {
            200: { description: 'JSON-RPC response (or batch of responses). Tool failures, including rate limits, are results with isError: true (plus Retry-After / X-Quota-* / X-Cache headers from the lookup).', headers: { ...retryAfter, ...parseHeaders }, content: { 'application/json': { schema: { type: ['object', 'array'] } } } },
            202: { description: 'Notification(s) accepted; no body' },
            400: { description: 'Parse error (-32700), invalid request (-32600), header mismatch (-32020), unsupported protocol version (-32022) or missing _meta (-32602)', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { description: 'Invalid API key (JSON-RPC error, data.code = invalid_api_key; no WWW-Authenticate challenge)', content: { 'application/json': { schema: { type: 'object' } } } },
            403: { description: 'Origin header present but not allowed', content: { 'application/json': { schema: { type: 'object' } } } },
            404: { description: 'Unknown method in a 2026-07-28 request (-32601)', content: { 'application/json': { schema: { type: 'object' } } } },
            413: { description: 'Body larger than the cap', content: { 'application/json': { schema: { type: 'object' } } } },
            429: { description: 'Too many non-lookup MCP messages from this IP, or too many invalid keys (data.code too_many_failed_auth)', headers: retryAfter, content: { 'application/json': { schema: { type: 'object' } } } },
            500: errResp('Unexpected internal error (`internal_error`); per-message failures are JSON-RPC -32603 inside a 200 response instead'),
            503: { description: 'Key storage unavailable', headers: retryAfter, content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
        get: mcpNotAllowed('get'),
        delete: mcpNotAllowed('delete'),
      },
    },
  };
}

// Glama connector ownership claim, served at /.well-known/glama.json. Replace the placeholder with your own claim token from glama.ai.
export const GLAMA_CLAIM = '<GLAMA_CLAIM_TOKEN>';
export const GLAMA_JSON = `{"$schema":"https://glama.ai/mcp/schemas/connector.json","claim":"${GLAMA_CLAIM}"}`;
