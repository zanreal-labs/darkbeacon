# AI agents (MCP)

Darkbeacon has a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp`, so assistants
such as Claude can read a chain, find routes and the way home, and (with permission) record signatures,
connection status and notes.

- Protocol: **MCP 2026-07-28** (https://modelcontextprotocol.io/specification/2026-07-28), Streamable HTTP,
  stateless: every message is its own `POST /mcp`, answered with JSON. Clients of the 2025 revisions
  (2025-03-26 to 2025-11-25, which start with `initialize`) are served too, statelessly; `GET` and `DELETE`
  answer 405 as the spec asks.
- Built with the official TypeScript SDK, `@modelcontextprotocol/server` 2.1.0 (pinned).
- The endpoint is a driving adapter: every tool calls the same use case the web app calls, as the caller,
  so the same permission checks apply. Nothing reads the database directly.

## Modes

An instance admin chooses the mode in **Admin → API access → AI agents**:

| Mode            | Who can connect                                                               |
| --------------- | ----------------------------------------------------------------------------- |
| `off` (default) | nobody; `/mcp` answers 404                                                    |
| `authenticated` | clients that sign in (OAuth) or carry an API key (`Authorization: Bearer`)    |
| `public`        | the above, and anonymous clients, read-only, for public maps opened to agents |

Each map narrows it in **Map settings → Public link → AI agents** (`?settings=public`): `off` (no agent sees the map, with any
key), `authenticated` (the default: keys whose scopes name the map) or `public` (also anonymous agents,
only while the map's public link is on, and only what the link shows).

## Connecting a client

Clients that support MCP authorization (Claude Desktop and claude.ai custom connectors, Claude Code, the
MCP Inspector, VS Code) only need the URL, `https://map.example.com/mcp`: they find the sign-in on their
own (see [OAuth](#oauth)), open the instance in a browser, you sign in as usual, check what the client may
do (and on which maps), and approve. The approval shows in **Account → Connected apps**, where it is
revoked.

```sh
claude mcp add --transport http darkbeacon https://map.example.com/mcp
```

For scripts and clients without OAuth, use an API key: **Account → API keys → New key**. For an assistant that should only read, pick _Read
everything_ and switch on _Read-only_; for one that records signatures, add `signatures:write` (and
`connections:write`, `systems:write` for connections and notes), ideally only on the map it works on.

**Claude Code** with a key:

```sh
claude mcp add --transport http darkbeacon https://map.example.com/mcp \
  --header "Authorization: Bearer dbk_pat_..."
```

**Claude Desktop** with a key (through the `mcp-remote` bridge, which adds the header), in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "darkbeacon": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://map.example.com/mcp", "--header", "Authorization:${DBK_TOKEN}"],
      "env": { "DBK_TOKEN": "Bearer dbk_pat_..." }
    }
  }
}
```

A public instance (mode `public`) can also be added as a custom connector with just the URL; it then sees
only the public maps opened to agents.

**VS Code, Cursor and other clients** that speak Streamable HTTP: URL `https://map.example.com/mcp`, header
`Authorization: Bearer dbk_pat_...`. For example `.vscode/mcp.json`:

```json
{
  "servers": {
    "darkbeacon": {
      "type": "http",
      "url": "https://map.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:darkbeacon-token}" }
    }
  },
  "inputs": [
    {
      "id": "darkbeacon-token",
      "type": "promptString",
      "password": true,
      "description": "Darkbeacon API key"
    }
  ]
}
```

**MCP Inspector** (to try it): `npx @modelcontextprotocol/inspector`, transport _Streamable HTTP_, URL
`https://map.example.com/mcp`, and the `Authorization` header.

## Tools

Output is compact text for language models: one line per system or connection, names instead of ids,
short ids (the last 8 characters) where a tool needs one back, `next <cursor>` for the next page.

| Tool                 | What it does                                                                  | Scope (keys)          |
| -------------------- | ----------------------------------------------------------------------------- | --------------------- |
| `list_maps`          | maps the key can read (anonymous: public maps opened to agents)               | `maps:read`           |
| `get_map`            | the chain: systems (class, statics, effect, status), connections, exits       | `maps:read` (+ reads) |
| `find_system`        | search systems by name, optionally whether they are on a map                  | `universe:read`       |
| `get_system_intel`   | class, region, statics with sizes, effect; on a map notes, signatures, pilots | as `get_map`          |
| `list_connections`   | connections most urgent first, mass and time left, which hulls fit            | `connections:read`    |
| `find_route`         | shortest, safer, high-sec, outlaw or pilot route over gates and the chain     | `routes:read`         |
| `nearest_hub`        | exits with jumps to the trade hubs; from a system, jumps to every hub         | `routes:read`         |
| `list_signatures`    | signatures of a system                                                        | `signatures:read`     |
| `get_recent_history` | latest changes, who and how (keys only)                                       | `audit:read`          |
| `add_signature`      | record a signature                                                            | `signatures:write`    |
| `update_signature`   | group, type, name, notes, link to a connection                                | `signatures:write`    |
| `add_connection`     | connect two systems (adds them when missing)                                  | `connections:write`   |
| `update_connection`  | mass, EOL, size, mass saved, danger, bubbles                                  | `connections:write`   |
| `add_note`           | append to (or replace) a system's notes                                       | `systems:write`       |

Write tools are listed only for keys that hold a write scope and are not read-only; anonymous clients get
read tools only. What `get_map` shows follows the scopes: notes and status need `systems:read`,
connections `connections:read`, signatures `signatures:read`, pilots `tracking:read`.

Resource: `darkbeacon://maps/{map}/snapshot` (JSON). Prompts: `summarise_chain` and `plan_route_home`.

Every write is in the map's history as the key's owner "via MCP (<key name>)". Requests count towards the
key's rate limit; anonymous clients are limited per address.

## Public mode

Anonymous agents see only maps whose admin opened them to agents (map MCP mode `public`) while their
public link is on, and only what the link shows (see [`public-maps.md`](public-maps.md)): the same
projection as the public page, so notes, signatures and pilots stay on the server unless the link shares
them. Maps are named by their public link (the readable name or the token). There are no write tools.
Opening a map to agents makes it discoverable to anyone who can reach `/mcp` (that is what `list_maps`
is for); keep it `authenticated` otherwise.

## Security

- `Authorization: Bearer` only (API keys or OAuth access tokens); browser sessions never authenticate
  `/mcp`. Invalid tokens get a 401 with a `WWW-Authenticate: Bearer` challenge, as for the REST API.
- A browser `Origin` other than the instance's (or an allowed CORS origin) is refused with 403, against DNS
  rebinding and cross-site pages, as the transport spec requires.
- Keys are narrowed per tool by their scopes, and per map by the map's own MCP mode.

## OAuth

Darkbeacon is the authorization server of its own `/mcp` (MCP authorization, spec 2026-07-28: OAuth 2.1,
RFC 9728 Protected Resource Metadata, RFC 8414 server metadata, Client ID Metadata Documents and RFC 7591
dynamic registration, PKCE, RFC 8707 resource indicators, RFC 9207 `iss`). Sign-in is the instance's own
(Discord or EVE); nothing else is configured.

1. Without a token (mode `authenticated`), `/mcp` answers 401 with
   `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp", scope="*:read"`.
2. `/.well-known/oauth-protected-resource/mcp` names the resource (`<PUBLIC_URL>/mcp`) and the
   authorization server (the instance); `/.well-known/oauth-authorization-server` lists the endpoints:
   `<PUBLIC_URL>/oauth/authorize` (a page), `/api/oauth/token`, `/api/oauth/register`, S256 only, public
   clients only (`token_endpoint_auth_method: none`), `client_id_metadata_document_supported`,
   `authorization_response_iss_parameter_supported`, and the scopes a client may ask for.
3. A client identifies with the HTTPS URL of its metadata document (fetched from public addresses only,
   no redirects, 16 KiB at most, kept an hour) or registers dynamically. Redirect URIs are https, loopback
   http (any port, RFC 8252) or a native app scheme, matched exactly.
4. `/oauth/authorize` asks the person to sign in (if needed), shows the client, where it sends them back,
   and what it asks for in words; they may limit it to some maps (picked by name) and make it read-only,
   then allow or cancel. Administration scopes are never granted to MCP clients; a client that asks for no
   scope gets read access.
5. The code is single use, five minutes, bound to the client, the redirect URI, the PKCE challenge and the
   resource. Using a code twice revokes the approval.
6. The token endpoint (`application/x-www-form-urlencoded`) issues an access token `dbk_oat_…` (one hour)
   and a refresh token `dbk_ort_…` (30 days, rotating; a refresh token used twice revokes the approval).
   Access tokens act as the person, narrowed by the approved scopes like a personal access token, and only
   on `/mcp` (anywhere else they are refused).
7. Approvals are listed and revoked in **Account → Connected apps**; creating and revoking them is in the
   instance audit. Writes made through them show "via MCP (<client name>)" in the map history.

In mode `public`, a client without a token is served anonymously (public maps only) and is never asked to
sign in; add a key or switch the instance to `authenticated` for clients that should act as someone.
