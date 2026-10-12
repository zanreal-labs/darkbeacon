# Public maps

A map admin can open a map to anyone with a link: read-only, no sign-in, live. Useful for a public
"way in and out" chain, a fleet that is not on the instance, or a stream overlay.

## Switching it on

**Map settings → Sharing → Public link**: switch it on and copy the link, `https://<instance>/p/<token>`.

- The token is 32 random characters (about 190 bits), so links cannot be guessed. An optional readable
  name (`/p/home-chain`) works as well, as long as it is set; it is as public as the token, so pick one
  only for maps meant to be found.
- **New link…** makes a new token; the old link stops working at once and open pages lose their live
  updates. Switching the link off does the same; switching it on again brings the same token back.
- Instance admins can switch public maps off for the whole instance (**Admin → API access**): every link
  stops working and none can be switched on.
- Every change of the link or of what it shows is in the map's history (the link itself is not).

## What the link shows

| Scope              | Shows                                                                                            | Default         |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------- |
| `topology`         | systems, their places, connections, statics, exits and the trade hubs                            | always          |
| `connectionStatus` | mass, time (EOL) and ship size of connections                                                    | on              |
| `signatures`       | signatures (ids, groups, types, site names)                                                      | off             |
| `labels`           | the map's labels on systems                                                                      | off             |
| `intel`            | notes, status, tags, custom and temporary names, dangerous and bubbled holes, the map's own hubs | off (sensitive) |
| `characters`       | tracked characters, their names, ships and where they are                                        | off (sensitive) |

What a scope does not share never leaves the server: the public view is read by the server as an
anonymous viewer of that one map, and everything it sends goes through a whitelist projection. Fields
that are not shared are blanked (empty notes, `unknown` status, no labels) and whole parts left out
(signatures, characters); events are forwarded only for what is shared, with no author. The map's owner,
its settings, access rules, webhooks, pings, history and the people looking at it are never public.

These scopes are the same vocabulary later sharing features (shared chains between instances) use.

## The public page

The page is the same map canvas as everywhere else, without editing, menus or presence: anonymous viewers
send no cursors and see nobody's. It updates live over the WebSocket (`public:<token>` streams, read-only).
Pages ask search engines not to index them (`noindex`, on by default, a switch in the settings) and send no
referrer. Reads and live subscriptions are rate limited per address.

## AI agents

A public map can also be opened to anonymous AI agents (**AI agents** on the same tab, MCP mode `public`);
they then read exactly what the link shows. See [`mcp.md`](mcp.md).

## For developers

- `GET /api/public/maps/{token or name}`: the map, the snapshot cut to its scopes, the static data of its
  systems and the stream to follow from `seq`. 404 for unknown or switched-off links.
- WebSocket: `{"op":"subscribe","stream":"public:<token>","sinceSeq":<seq>}`; `access.sharing_changed`
  (with no data) means "read the view again", an `error` on the stream means the link stopped working.
