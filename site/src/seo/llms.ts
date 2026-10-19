/**
 * What /llms.txt says (https://llmstxt.org) beyond the list of pages, and the order of that list.
 * Page titles and one-line summaries are not repeated here: the build reads them from each built
 * page's <title> and meta description (integrations/llms.ts), so they never drift.
 */
import { APP_URL, COMPANY_URL, REPO_URL, SITE_URL } from '../config';

/** Where a page's Markdown twin is served: `/index.md` for the homepage, `/sponsor.md` for /sponsor. */
export const markdownPath = (path: string) => (path === '/' ? '/index.md' : `${path}.md`);

/** Built pages that get no Markdown twin and stay out of /llms.txt. */
export const unlisted = new Set(['/404']);

/** Pages in the order /llms.txt lists them. Built pages missing here follow, in path order. */
export const pageOrder = ['/', '/features', '/wanderer', '/mcp-setup', '/sponsor'];

export const summary =
  'Darkbeacon is a live wormhole and chain mapper for EVE Online: a map a whole corporation edits at once, with signatures, routes to the trade hubs, kill intel, a capital jump planner, an import from Wanderer and an MCP endpoint for AI agents. It runs as one Docker container you host yourself, or on the hosted beta.';

export const notes = [
  `Beta, version 0.1.0. The hosted instance is open at ${APP_URL}; self-hosting is one Docker container (see the README).`,
  `Made by ZanReal (${COMPANY_URL}). Free to use and to self-host; there are no paid tiers. Not affiliated with or endorsed by CCP.`,
  `Every page below is Markdown made from the page at build time. Any page of ${SITE_URL} is also available as Markdown at its path plus \`.md\` (\`/index.md\` for the homepage).`,
  'AI agents connect over MCP at `<instance>/mcp` (Streamable HTTP, OAuth or an API key); the MCP setup page has the steps per client.',
];

const raw = (file: string) => `${REPO_URL.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/${file}`;

export interface Link {
  title: string;
  url: string;
  text: string;
}

export const docs: Link[] = [
  { title: 'README', url: raw('README.md'), text: 'What Darkbeacon is, the quick start, configuration, and how the container is put together.' },
  { title: 'AI agents (MCP)', url: raw('docs/mcp.md'), text: 'The MCP endpoint: protocol, sign-in, scopes, every tool, resource and prompt.' },
  { title: 'API', url: raw('docs/api.md'), text: 'The REST API the app and integrations use, its keys, OpenAPI and AsyncAPI documents.' },
  { title: 'Moving from Wanderer', url: raw('docs/migrate-from-wanderer.md'), text: 'Importing Wanderer maps: what comes over, from where, and keeping both in sync while a group moves.' },
  { title: 'Public maps', url: raw('docs/public-maps.md'), text: 'Opening a map read-only to anyone with a link.' },
];

export const app: Link[] = [
  { title: 'Hosted instance', url: APP_URL, text: 'Sign in with EVE Online or Discord and use the map.' },
  { title: 'Source on GitHub', url: REPO_URL, text: 'Code, issues and releases.' },
  { title: 'Report a problem', url: `${REPO_URL}/issues`, text: 'GitHub issues; inside the app, Help, Report a problem.' },
];

export const optional: Link[] = [
  { title: 'Engineering spec', url: raw('docs/SPEC.md'), text: 'The contract every module builds against: runtime, repository layout, events, identity and access, plugins.' },
  { title: 'Security notes', url: raw('docs/security.md'), text: 'API keys, public maps and MCP: threats and what stops them.' },
  { title: 'Scaling', url: raw('docs/scaling.md'), text: 'How far one instance goes and how to run more than one process.' },
  { title: 'Backups', url: raw('docs/backups.md'), text: 'Built-in SQLite backups and restore; PostgreSQL notes.' },
  { title: 'Telemetry', url: raw('docs/telemetry.md'), text: 'Every anonymous field an instance can send, and how to turn it off.' },
  { title: 'Full site as one file', url: `${SITE_URL}/llms-full.txt`, text: 'Every page above, in Markdown, in one file.' },
];
