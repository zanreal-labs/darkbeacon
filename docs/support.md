# Support tickets and feedback

Every Darkbeacon instance has a help menu (the question mark at the bottom of the left rail; in the top bar
on phones) with **Report a problem**, **Send feedback** and **My tickets**; the first two are also in the
account menu. They open the **support hub**: by default the maintainers' own instance,
`https://app.darkbeacon.space`, in a small window. Tickets are answered by the maintainers (ZanReal) and
the answer shows up on the hub's page and, as a count, on the help icon of the instance the pilot came from.

This is separate from [anonymous telemetry](telemetry.md): a ticket carries what someone wrote and is tied
to one of their EVE characters, so it never goes through telemetry, and nothing is sent until someone
presses Send.

## What a ticket sends

The message, the category (bug, help, question), the EVE character the pilot picks from their account on
the hub (their main character unless they pick another), and the details below. The hub shows every detail as a line before sending, and each line can be removed.

| Detail             | Example                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Darkbeacon version | `0.1.0`, and the build's commit when the image has one (`DBK_COMMIT`) |
| Database           | `sqlite` or `postgres`                                                |
| Sign-in method     | `discord` or `eve`                                                    |
| Page               | the kind of page (`map`, `admin`, `jump`...), never its address       |
| Tab                | the admin tab or map settings section, from a fixed list              |
| Screen             | `phone`, `tablet` or `desktop`                                        |
| Browser, system    | families only (`firefox`, `linux`), never the user agent              |
| Language, theme    | `pl-PL`; a built-in theme or `custom`; light or dark                  |
| Demo instance      | yes or no                                                             |
| Recent errors      | the last five uncaught errors of the page, scrubbed (see below)       |

Two more are offered **unticked** and only sent when ticked: the instance's address (host name) and the
open map's size (how many systems, connections and signatures).

**Never sent:** map contents, system or signature data, map addresses (slugs), notes, the instance id, IP
addresses or emails. Error lines are scrubbed in the browser and again on the hub: URLs, map addresses,
UUIDs, quoted strings and numbers of seven digits or more are replaced (`TypeError: x of <str> at <url>`).
The hub accepts only the fields of `SupportContext` (`packages/shared/src/support.ts`) and refuses any other.

The ticket form says:

> This sends your message and the details listed below to the Darkbeacon maintainers (ZanReal), stored in
> PostHog (EU). Your ticket is linked to the EVE character you pick, so you can follow it from any
> Darkbeacon instance. We don't send map contents, system names or your instance's address unless you
> tick them. You can ask us to delete your tickets.

Feedback ("Quick feedback": a rating from 1 to 5 and optional text; "Feature request": text) says:

> Anonymous unless you sign in. No reply is sent; open a ticket if you need one.

Anonymous feedback creates no person profile in PostHog and carries no IP or location. The thumbs up or down
in the help menu are different again: an anonymous telemetry event with an enum and the kind of page
(`feedback_rated`, see [docs/telemetry.md](telemetry.md)), shown only while telemetry is on.

## Turning it off or pointing it elsewhere

| Variable          | Default                          | Meaning                                                           |
| ----------------- | -------------------------------- | ----------------------------------------------------------------- |
| `SUPPORT_HUB_URL` | `https://app.darkbeacon.space` | where the help menu sends people; `off` hides the support entries |

Without a hub the help menu keeps "What's new" and the documentation. A fork can run its own hub (below)
and point its builds at it with `SUPPORT_HUB_URL`.

## How it works

- **Sign-in on the hub.** The hub is an ordinary Darkbeacon instance and pilots sign in to it the same way
  as to any instance: its sign-in page (EVE Online or Discord, whichever the hub uses), its session cookie
  and its account. There is no separate support sign-in. A signed-out pilot on `/support` is offered the
  hub's sign-in page (`/login?next=/support?...`), which comes back to the support page afterwards; the
  return address is checked twice (the page only builds `/support` addresses, the sign-in only follows paths
  on its own site), so it can never send anyone elsewhere. Changes are protected like every other route of
  the app: the session cookie is `SameSite=Lax` and the server ignores it on any request whose `Origin` is
  not the hub's own (a cross-site request is anonymous: 401). The account on the hub is not the account on
  the instance the pilot came from.
- **Who owns a ticket.** Tickets belong to an EVE character linked to the pilot's account on the hub: the
  form has a character picker (the main character by default), and My tickets lists the tickets of every
  linked character, grouped by character. A character the account does not hold is refused (403). An
  account without an EVE character (signed in with Discord and nothing linked) is asked to link one first,
  with a link to the app's link-character flow. The support identity is `eve:<characterId>`. The app keeps
  the EVE SSO `owner` hash of every linked character (from its sign-in or link); when it changes (the
  character was sold or moved to another EVE account, and the new owner signed in or linked it) the new owner
  gets a fresh identity, `eve:<characterId>:o2`, then `:o3`, so a buyer never sees the seller's tickets; a
  character that returns to an earlier owner finds that owner's tickets again.
- **The popup.** The instance opens `<hub>/support?kind=…&origin=<instance>&ctx=…`. When the hub's page
  is ready it posts `ready` to the instance's origin (and nowhere else); the instance answers with the
  context, checking that the message came from the hub's origin and from the popup it opened. The hub
  checks the context came from the opener and from the origin in the URL, sanitizes it to the allow-list and
  shows it. The short `?ctx=` (no errors, no opt-ins) is the fallback when the popup lost its opener; the
  context is kept in the popup's session storage across the sign-in.
- **Unread badge.** After signing in from an instance, the hub asks "Show answers on map.example.com?".
  When the pilot allows it, the hub makes an opaque, revocable handle bound to that origin and to the
  pilot's hub account (the answers of every character of it), and posts it to the opener, which keeps it
  for its own account (sealed in its database). The instance's pages then poll
  `GET <hub>/api/support/unread?h=<handle>` every two minutes: any origin may read it (no cookies), it
  answers `{ "unread": n }` and nothing else, refuses a handle from another origin, and is limited to six
  checks a minute per handle. The hub keeps only a SHA-256 of each handle; the pilot can revoke them on the
  hub's My tickets tab. On the hub itself the help menu opens the support page in the app, with the app's
  session, and the badge counts the signed-in account's unread answers.
- **Limits on the hub**, per character: 5 new tickets an hour, 30 replies an hour, 10 feedback answers an
  hour (per address when anonymous); per account, 10 new handles an hour; on top of the instance's limit
  per address.
  Ticket lists and threads are reused for 45 seconds.
- **Audit.** On the hub, `support.ticket_created` (ticket id, category, desk, character id; never the
  message or the context), `support.replied` and `support.ticket_updated` are on the instance audit.

## Running the hub

A hub is an ordinary Darkbeacon instance with `SUPPORT_HUB=on`. Tickets live either in **PostHog Support**
(`SUPPORT_BACKEND=posthog`, the default) or in the hub's own database (`SUPPORT_BACKEND=local`), where its
instance admins answer them in **Admin > Support**. Pilots see no difference between the two.

| Variable                    | Needed for       | Meaning                                                                     |
| --------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `SUPPORT_HUB`               | a hub            | `on`                                                                        |
| `SUPPORT_BACKEND`           | a hub            | `posthog` (default) or `local`                                              |
| `EVE_CLIENT_ID` / `_SECRET` | a hub            | the instance's own EVE SSO app, as on any instance (pilots link characters) |
| `SUPPORT_POSTHOG_HOST`      | posthog          | default `https://eu.i.posthog.com`                                          |
| `SUPPORT_PUBLIC_TOKEN`      | posthog          | the Support widget's public token                                           |
| `SUPPORT_SECRET_KEY`        | posthog          | the Support "Secret API key" (identity verification); server only           |
| `SUPPORT_SURVEYS_KEY`       | posthog feedback | the support project's API key (`phc_...`); server only                      |
| `SUPPORT_SURVEY_QUICK`      | posthog feedback | `<survey id>:<rating question id>:<text question id>`                       |
| `SUPPORT_SURVEY_FEATURE`    | posthog feedback | `<survey id>:<text question id>`                                            |
| `SUPPORT_WEBHOOK_SECRET`    | optional         | 24+ characters; turns on `POST /api/support/webhook`                        |

The hub needs no EVE application or callback of its own: pilots sign in with the instance's sign-in and
link characters with its EVE SSO app (callback `<PUBLIC_URL>/api/auth/eve/callback`, already registered for
any instance). Pilots from other instances make an account on the hub, so a public hub keeps sign-ups open
(Admin > Access, the default). `SUPPORT_EVE_CLIENT_ID` / `SUPPORT_EVE_CLIENT_SECRET` from earlier versions
are no longer read (the hub logs a reminder when they are set).

No secret ever reaches a browser: the hub's server talks to PostHog. A misconfigured hub logs why at start
and stays off (its routes answer 404; the page says support is not set up).

### PostHog Support, step by step (the maintainers' setup)

PostHog Support (formerly Conversations) is in alpha; the hub uses the HTTP API of its web widget from the
server (the calls `posthog-js` makes, verified against `packages/browser/src/extensions/conversations` and
PostHog's `products/conversations/backend/api/widget.py`). That API is not documented and may change; the
staff API cannot create tickets, which is why it is not used. If it breaks, switch to
`SUPPORT_BACKEND=local` until it is fixed: pilots keep the same pages (tickets made in PostHog stay there).

1. In the ZanReal organization create a **separate** project, "Darkbeacon support", in the **EU** region
   (not the telemetry project: tickets are personal data, telemetry is anonymous).
2. Project settings: turn on **Discard client IP data**.
3. **Support** (Conversations): enable it **API only** (the widget stays off; nothing of PostHog runs in
   browsers). Copy the **public token** (`SUPPORT_PUBLIC_TOKEN`) and generate the **Secret API key**
   (`SUPPORT_SECRET_KEY`).
4. Support settings, **Allowed domains**: `app.darkbeacon.space`. The hub sends its own origin as
   `Origin` and `Referer`, so PostHog accepts its calls and refuses the token anywhere else.
5. **Surveys**: create two surveys of type **API** (no popup):
   - "Quick feedback": a rating question (1-5) and an open text question;
   - "Feature request": an open text question.
     Copy each survey's id and its question ids (the survey's API / implementation view shows them) into
     `SUPPORT_SURVEY_QUICK=<survey>:<rating question>:<text question>` and
     `SUPPORT_SURVEY_FEATURE=<survey>:<text question>`. Copy the project API key (`phc_...`) into
     `SUPPORT_SURVEYS_KEY`.
6. Optional, faster unread badges: a PostHog **workflow** on "support ticket message from staff" that sends
   `POST https://app.darkbeacon.space/api/support/webhook` with the header
   `x-support-webhook-secret: <SUPPORT_WEBHOOK_SECRET>` and the body `{"distinct_id": "<the ticket's distinct
id>"}` (pick the workflow's variable for it).
   Without it answers show within a minute (the hub's cache).
7. Answer tickets in PostHog (Support inbox). The character's name is the ticket's name; the details are
   in the ticket's session context, with `category`.

### Environment on the maintainers' instance (mothership)

```sh
SUPPORT_HUB=on
SUPPORT_BACKEND=posthog
SUPPORT_POSTHOG_HOST=https://eu.i.posthog.com
SUPPORT_PUBLIC_TOKEN=<public token from step 3>
SUPPORT_SECRET_KEY=<Secret API key from step 3>
SUPPORT_SURVEYS_KEY=phc_<support project key>
SUPPORT_SURVEY_QUICK=<survey id>:<rating question id>:<text question id>
SUPPORT_SURVEY_FEATURE=<survey id>:<text question id>
SUPPORT_WEBHOOK_SECRET=<openssl rand -base64 32>   # optional, step 6
```

The instance's own `EVE_CLIENT_ID` / `EVE_CLIENT_SECRET` (and Discord, if it uses Discord) are all the
sign-in the hub needs.

`SUPPORT_HUB_URL` stays unset there: a hub sends its own help menu to itself (in the app, not a popup).
`PUBLIC_URL` must be `https://app.darkbeacon.space`.

### The hub's own store

`SUPPORT_BACKEND=local` needs nothing but the instance's own sign-in. Tickets, messages and feedback are kept in the hub's
database (tables `support_*`, in backups like everything else). Instance admins get **Admin > Support**:
the open tickets (newest change first), each with its thread, the details sent with it, an answer box, the
status (new, waiting on us, waiting on the pilot, on hold, resolved) and the priority; and the feedback.
Answers carry the name "Darkbeacon support". To delete a pilot's tickets on request, delete their rows from
`support_tickets` and `support_messages` (`distinct_id` = `eve:<character id>`, and `:o<n>` variants).

### Trying a hub locally

Any instance can be a hub with its own store. With [`tools/local.sh`](../tools/local.sh), add to
`.env.local` next to the usual `PUBLIC_URL=https://darkbeacon.localhost` and EVE app:

```sh
SUPPORT_HUB=on
SUPPORT_BACKEND=local
```

`tools/local.sh up`, sign in at https://darkbeacon.localhost as usual, and the help menu opens the support
page in the app (no popup: the instance is its own hub). Tickets show up in Admin > Support. Nothing else is
needed: no second EVE callback and no separate application.

### Earlier versions

The first hub had its own EVE sign-in (`/support/login`, `/support/callback`, the `dbk_support` cookie and
`SUPPORT_EVE_CLIENT_*`). Those are gone. Its sessions were sealed cookies (no table); the unread handles it
made belonged to one character and could not be tied to an account, so migration `support/0002_app_sign_in`
drops them. An instance that polls such a handle gets a 404, forgets it, and the hub offers "Show answers on
..." again at the next visit. Tickets, identities and notes are unchanged.

## Code

- `packages/modules/support`: identity rules, limits, survey events, the `SupportDesk` port and the use
  cases (`SupportHub`, `SupportInbox`, `SupportClientService`).
- `apps/server/src/adapters/support`: `PostHogSupportDesk`, `PostHogSurveys`, `LocalSupportDesk`, the
  Kysely stores, and `AppSupportAccounts` (the account's linked characters from identity).
- `apps/server/src/modules/support`: settings and the controllers (on the app's session).
- `apps/web/src/shell/HelpMenu.tsx`, `apps/web/src/lib/support.ts`: the help menu, the context and the
  popup handshake; `apps/web/src/screens/SupportPage.tsx` (the hub page) and `SupportInbox.tsx`.
