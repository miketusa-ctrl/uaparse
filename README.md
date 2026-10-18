# UAParse

Parse a User-Agent: browser, OS, device, plus bot, search crawler, AI crawler and AI agent flags.

## Live service

- Web app and API: https://uaparse.mike-tusa.workers.dev/
- Pricing: https://uaparse.mike-tusa.workers.dev/docs
- Support: digitalpromohub.support@gmail.com

## Use it from an AI assistant (MCP)

UAParse is a remote MCP server (Streamable HTTP) at `https://uaparse.mike-tusa.workers.dev/mcp`. Tools: `parse_user_agent`.

Cursor, Cline and Windsurf accept this config:

```json
{
  "mcpServers": {
    "uaparse": {
      "type": "http",
      "url": "https://uaparse.mike-tusa.workers.dev/mcp"
    }
  }
}
```

Claude Desktop: open Settings > Connectors, choose "Add custom connector" and paste `https://uaparse.mike-tusa.workers.dev/mcp`. Or, for clients that only support local (stdio) servers, use the mcp-remote bridge: `npx mcp-remote https://uaparse.mike-tusa.workers.dev/mcp`.

VS Code uses a `servers` key instead of `mcpServers`.

The `server.json` file is the [MCP Registry](https://registry.modelcontextprotocol.io) manifest for this server.

## Run your own copy

Requires Node.js 22+ and a Cloudflare account.

```bash
npm install
npx wrangler@4 dev      # local dev server
```

`wrangler.toml` is a template: create your own KV namespaces / D1 databases / rate-limit namespaces and replace the `<PLACEHOLDER>` values before `npx wrangler@4 deploy`. Any secrets the Worker reads go in `wrangler secret put` (or `.dev.vars` locally), never in the repo.

## Third-party data

Uses ua-parser-js 1.0.41 (MIT); see `THIRD_PARTY_NOTICES.md`.

## License

MIT (c) Digital Promo Hub. See [LICENSE](LICENSE).
