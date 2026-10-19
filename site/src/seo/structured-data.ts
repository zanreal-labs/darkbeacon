/**
 * Structured data (schema.org JSON-LD) for every page, from one place. Layout.astro calls
 * `structuredData()` and prints the result as a single `@graph`:
 *
 * - on every page: the publisher (ZanReal), the website, and the page itself (WebPage);
 * - on subpages: a BreadcrumbList from the homepage;
 * - per page, what the page really is: the app on the homepage, a TechArticle on /mcp-setup,
 *   the in-game ISK donation on /sponsor.
 *
 * Only schema.org properties, and only what the page itself says: no ratings, no review counts.
 * Nodes link to each other by `@id`, so the publisher and the app are described once.
 */
import { APP_URL, COMPANY_URL, DONATION_CHARACTER, DONATION_CHARACTER_ID, REPO_URL, SITE_URL } from '../config';

type Node = Record<string, unknown>;

export interface PageInfo {
  /** Path as served: `/`, `/sponsor`. */
  path: string;
  canonical: string;
  title: string;
  description: string;
  ogImage: string;
  ogImageAlt: string;
}

const HOME = `${SITE_URL}/`;
export const ids = {
  publisher: `${COMPANY_URL}/#organization`,
  website: `${HOME}#website`,
  app: `${HOME}#app`,
  page: (canonical: string) => `${canonical}#webpage`,
  breadcrumb: (canonical: string) => `${canonical}#breadcrumb`,
};

const ref = (id: string) => ({ '@id': id });

const publisher: Node = {
  '@type': 'Organization',
  '@id': ids.publisher,
  name: 'ZanReal',
  url: COMPANY_URL,
};

const website: Node = {
  '@type': 'WebSite',
  '@id': ids.website,
  url: HOME,
  name: 'Darkbeacon',
  // The footer's line.
  description: 'The live wormhole mapper for EVE Online.',
  inLanguage: 'en',
  publisher: ref(ids.publisher),
};

/** The game the app is for; the footer names CCP as its owner. */
const eveOnline: Node = { '@type': 'VideoGame', name: 'EVE Online', url: 'https://www.eveonline.com' };

/** Breadcrumb names, shorter than page titles. Pages not listed fall back to their title. */
const crumbs: Record<string, string> = {
  '/features': 'Features',
  '/wanderer': 'Wanderer compared',
  '/mcp-setup': 'Set up an AI agent',
  '/sponsor': 'Sponsor',
};

/**
 * The homepage's app. Everything here is on the homepage: one Docker container or the hosted
 * instance, version 0.1.0 (Roadmap), beta, free (no tiers: see /sponsor and the README).
 * applicationCategory: Darkbeacon is a tool for a game, not a game, so UtilitiesApplication rather
 * than GameApplication; `about` names the game.
 */
function app(page: PageInfo): Node {
  return {
    '@type': 'SoftwareApplication',
    '@id': ids.app,
    name: 'Darkbeacon',
    description: page.description,
    url: APP_URL,
    applicationCategory: 'UtilitiesApplication',
    applicationSubCategory: 'Wormhole mapper',
    operatingSystem: 'Web, Docker',
    softwareVersion: '0.1.0',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    image: page.ogImage,
    screenshot: `${SITE_URL}/shots/chain-2400.webp`,
    about: eveOnline,
    sameAs: [REPO_URL],
    publisher: ref(ids.publisher),
    mainEntityOfPage: ref(ids.page(page.canonical)),
  };
}

/** /mcp-setup: a technical how-to about connecting MCP clients (several clients, so no single HowTo). */
function mcpArticle(page: PageInfo): Node {
  return {
    '@type': 'TechArticle',
    '@id': `${page.canonical}#article`,
    headline: page.title,
    description: page.description,
    url: page.canonical,
    image: page.ogImage,
    inLanguage: 'en',
    about: ref(ids.app),
    author: ref(ids.publisher),
    publisher: ref(ids.publisher),
    isBasedOn: `${REPO_URL}/blob/main/docs/mcp.md`,
    mainEntityOfPage: ref(ids.page(page.canonical)),
  };
}

/** /sponsor: the one thing the page asks for, ISK given in game to the author's character. */
function donation(): Node {
  return {
    '@type': 'DonateAction',
    name: `Send ISK in game to ${DONATION_CHARACTER}`,
    description: 'Give ISK to the author’s main character in EVE Online. No tiers, no rewards, no priority.',
    recipient: {
      '@type': 'Person',
      name: DONATION_CHARACTER,
      description: 'The main EVE Online character of Darkbeacon’s author.',
      image: `https://images.evetech.net/characters/${DONATION_CHARACTER_ID}/portrait?size=256`,
    },
  };
}

function breadcrumb(page: PageInfo): Node {
  return {
    '@type': 'BreadcrumbList',
    '@id': ids.breadcrumb(page.canonical),
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: HOME },
      { '@type': 'ListItem', position: 2, name: crumbs[page.path] ?? page.title, item: page.canonical },
    ],
  };
}

/** Folds a page's own `jsonLd` prop into the node of the same type, or adds it as a node. */
function merge(graph: Node[], extra: Node | undefined): Node[] {
  if (!extra) return graph;
  const { '@context': _context, ...node } = extra;
  const same = graph.find((n) => n['@type'] === node['@type']);
  if (!same) return [...graph, node];
  // The graph wins on every key both have, so an inline publisher object never replaces the
  // reference to the one publisher node; keys only the page has are kept.
  for (const [key, value] of Object.entries(node)) if (!(key in same)) same[key] = value;
  return graph;
}

export function structuredData(page: PageInfo, extra?: Record<string, unknown>): Node {
  const home = page.path === '/';
  const webPage: Node = {
    '@type': 'WebPage',
    '@id': ids.page(page.canonical),
    url: page.canonical,
    name: page.title,
    description: page.description,
    inLanguage: 'en',
    isPartOf: ref(ids.website),
    publisher: ref(ids.publisher),
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: page.ogImage,
      width: 1200,
      height: 630,
      caption: page.ogImageAlt,
    },
  };

  const graph: Node[] = [publisher, website, webPage];

  if (home) {
    webPage.about = ref(ids.app);
    webPage.mainEntity = ref(ids.app);
    graph.push(app(page));
  } else {
    webPage.about = ref(ids.app);
    webPage.breadcrumb = ref(ids.breadcrumb(page.canonical));
    graph.push(breadcrumb(page));
  }

  if (page.path === '/mcp-setup') {
    webPage.mainEntity = ref(`${page.canonical}#article`);
    graph.push(mcpArticle(page));
  }

  if (page.path === '/sponsor') webPage.potentialAction = donation();

  return { '@context': 'https://schema.org', '@graph': merge(graph, extra) };
}
