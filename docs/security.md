# Security notes: API keys, public maps, MCP

What changed when Darkbeacon opened up to integrations and agents, what can go wrong, and what stops it.

## Assets

- Map intel: systems, connections, signatures, notes, who is where (character positions). The value of a
  mapper is that the other side does not have it.
- Accounts and their sessions; instance administration.
- Credentials: session cookies, API keys, webhook secrets, the Discord bot token, EVE refresh tokens.
- The audit trail (who changed what, from where).

## Principles

1. **One authorization path.** Every REST call, WebSocket subscription and MCP tool runs the same use
   cases with the same actor model. A key is not a role: it narrows its principal's own rights
   (`capMapRole`), and edges only add checks (scopes per route and per tool), never skip one.
2. **Deny by default.** Routes outside the contract refuse keys; session-only routes refuse keys; the
   MCP endpoint and public maps are off until switched on (MCP) or opted into per map (public links);
   projections are whitelists.
3. **Secrets never stored or logged in clear.** Keys are kept as an HMAC; tokens are shown once and never
   in events, audit records, errors or logs.

## Threats and mitigations

| Threat                                                                                         | Mitigation                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stolen API key                                                                               | Scopes (least privilege per map), expiry, IP allow-list, read-only, per-key rate limit, last-used time and address in the lists, revoke and rotate in one click (effective on the next request), admins can revoke any key. Tokens have a recognisable prefix and checksum for secret scanners. |
| A key doing more than its owner                                                                | The owner's role is resolved on every request and capped by the scopes; creation refuses scopes beyond the owner's rights; `admin:` scopes need an instance admin and never act as owner; keys cannot manage keys.                                                                              |
| A database dump                                                                                | Only HMAC-SHA256 of the secret with a pepper derived from `SECRET_KEY` (not in the database). Tokens carry ~190 random bits, so a slow hash adds nothing but CPU cost per request (and a DoS lever); see `HmacTokenSecrets`.                                                                    |
| Guessing tokens                                                                                | 190-bit secrets; the checksum rejects garbage without a database read; failed tokens are counted per address and refused (429) after ten a minute; unknown and wrong tokens fail alike and take the same time (the hash is computed either way, compared in constant time).                     |
| Spoofing the client address (IP allow-lists, limits)                                           | `X-Forwarded-For` is believed only as far as proxies on private networks or the host added it; a client reaching the server directly is its socket address. Put the reverse proxy on a private network or the same host.                                                                        |
| CSRF on cookie sessions                                                                        | Unchanged: SameSite=Lax cookies, and the actor guard now ignores cookies on any cross-origin request (an `Origin` that is not the instance).                                                                                                                                                    |
| Cross-site use of the API                                                                      | CORS off by default; allowed origins never get credentials, so only Bearer keys work cross-origin.                                                                                                                                                                                              |
| DNS rebinding / cross-site pages on `/mcp`                                                     | `Origin` must be the instance or an allowed origin (403 otherwise); `/mcp` never accepts cookies.                                                                                                                                                                                               |
| Prompt injection through map data (notes, signature names) reaching an agent with write scopes | Agents act with the key's scopes only; give assistants read-only keys or write scopes on one map; every write is audited "via MCP (<key name>)" and can be reverted from the history. Tool descriptions say what they change.                                                                   |
| Public link leaking intel                                                                      | Whitelist projection on the server for snapshots, events and MCP output; safe defaults (topology and connection status); sensitive scopes marked; tests grep the public output for planted secrets. Events carry no author.                                                                     |
| Public link enumeration                                                                        | 32-character random tokens; 404 for unknown or switched-off links (the same answer); rate limits per address on reads and subscriptions; `noindex` and `no-referrer` by default.                                                                                                                |
| Anonymous viewers watching who is online                                                       | Public viewers never join presence (no cursors in or out); characters are off unless chosen.                                                                                                                                                                                                    |
| Abuse of public reads and MCP                                                                  | Per-address limits on public reads, public subscriptions and anonymous MCP calls; per-key limits for keys; MCP request bodies capped at 256 KiB.                                                                                                                                                |
| Keys or tokens in logs                                                                         | The server never logs headers or bodies; MCP requests are rebuilt without `Authorization` and `Cookie` before the SDK sees them; audit records keep the key's id and name only.                                                                                                                 |
| A key's owner loses access                                                                     | Roles are re-resolved per request; WebSocket subscriptions are re-checked on access changes and every minute; revoked and expired keys fail at once (the socket's next re-check closes it).                                                                                                     |
| Federation (later)                                                                             | `federation:*` scopes are reserved and refused today, so no key can be made that a later feature would silently widen.                                                                                                                                                                          |

## What is out of scope here

- OAuth for MCP clients is planned (see `mcp.md`); until then agents use API keys.
- A multi-process deployment would need the rate limiters in shared storage; Darkbeacon is one process by
  design (`docs/SPEC.md`).
