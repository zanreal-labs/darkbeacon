/**
 * Markdown for language models, written once the site is built:
 *
 * - a Markdown twin of every page at its path plus `.md` (`/index.md`, `/sponsor.md`), converted
 *   from the page's own built HTML (its <main> and the footer's credits), so it says exactly what
 *   the page says and follows every change to it without a second copy of the text;
 * - `/llms.txt` (https://llmstxt.org): the summary and notes in src/seo/llms.ts, then every page's
 *   twin with the page's own title and meta description, then docs and app links;
 * - `/llms-full.txt`: the summary followed by every twin in full.
 *
 * These are generated after the build, not as Astro endpoints, because the twins are made from the
 * rendered pages, which an endpoint cannot read while the same build is rendering them.
 * None of them is a page, so none is in the sitemap; vercel.json sets their content types.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import TurndownService from 'turndown';
import { SITE_URL } from '../src/config';
import { app, docs, markdownPath, notes, optional, pageOrder, summary, unlisted, type Link } from '../src/seo/llms';

interface Page {
  path: string;
  title: string;
  description: string;
  canonical: string;
  markdown: string;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return entities[code.toLowerCase()] ?? whole;
  });

const pick = (html: string, re: RegExp) => decode(html.match(re)?.[1]?.trim() ?? '');

function converter(base: string): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
  });
  const absolute = (href: string) => {
    if (href.startsWith('#')) return `${base}${href}`;
    try {
      return new URL(href, `${SITE_URL}/`).href;
    } catch {
      return href;
    }
  };
  const classes = (node: HTMLElement) => (node.getAttribute('class') ?? '').split(/\s+/);

  // What is not content: decoration hidden from assistive tech, controls, scripts.
  td.remove(['script', 'style', 'noscript', 'template', 'canvas', 'video', 'form', 'button', 'input', 'select', 'textarea']);
  td.remove(
    (node) =>
      node.nodeName.toLowerCase() === 'svg' || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden'),
  );

  // Headings one level down: the twin's own H1 is the page title.
  td.addRule('heading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const level = Math.min(Number(node.nodeName.charAt(1)) + 1, 6);
      const text = content.replace(/\s+/g, ' ').trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
    },
  });

  td.addRule('link', {
    filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) => {
      const text = content.replace(/\s+/g, ' ').trim();
      return text ? `[${text}](${absolute((node as HTMLElement).getAttribute('href') ?? '')})` : '';
    },
  });

  // Button links (calls to action) on lines of their own, so a row of them reads as a list.
  // Added after the plain link rule because Turndown tries the rules added last first.
  td.addRule('button-link', {
    filter: (node) => node.nodeName === 'A' && classes(node).includes('btn'),
    replacement: (content, node) => {
      const text = content.replace(/\s+/g, ' ').trim();
      const href = (node as HTMLElement).getAttribute('href');
      return text && href ? `\n- [${text}](${absolute(href)})\n` : '';
    },
  });

  // Pictures keep their alt text; decorative ones (empty alt) go.
  td.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const alt = (el.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
      const src = el.getAttribute('src');
      return alt && src ? `![${alt.replace(/[[\]]/g, '\\$&')}](${absolute(src)})` : '';
    },
  });

  // ARIA tables (the Wanderer comparison is divs with table roles) as Markdown tables.
  td.addRule('aria-table', {
    filter: (node) => node.getAttribute('role') === 'table',
    replacement: (_content, node) => {
      const cell = (el: Element) => td.turndown(el.innerHTML).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
      const rows = Array.from((node as HTMLElement).querySelectorAll('[role="row"]')).map((row) =>
        Array.from(row.children)
          .filter((el) => /^(columnheader|rowheader|cell)$/.test(el.getAttribute('role') ?? ''))
          .map(cell),
      );
      if (!rows.length) return '';
      const [head, ...body] = rows;
      const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
      return `\n\n${[line(head!), line(head!.map(() => '---')), ...body.map(line)].join('\n')}\n\n`;
    },
  });

  // Description lists (specs, tools, facts): one item per term, extra descriptions in brackets.
  td.addRule('description-list', {
    filter: 'dl',
    replacement: (_content, node) => {
      const inline = (el: Element) => td.turndown(el.innerHTML).replace(/\s+/g, ' ').trim();
      const groups: Element[][] = [];
      for (const child of Array.from(node.children)) {
        if (child.nodeName === 'DIV') groups.push(Array.from(child.children));
        else if (child.nodeName === 'DT' || !groups.length) groups.push([child]);
        else groups[groups.length - 1]!.push(child);
      }
      const items = groups.map((group) => {
        const term = group.filter((el) => el.nodeName === 'DT').map(inline).join(', ');
        const [first, ...rest] = group.filter((el) => el.nodeName === 'DD').map(inline);
        const text = [first, ...rest.map((d) => `(${d})`)].filter(Boolean).join(' ');
        return term ? `- **${term}**: ${text}` : `- ${text}`;
      });
      return `\n\n${items.join('\n')}\n\n`;
    },
  });

  return td;
}

/**
 * The built HTML is minified: text that CSS sets on its own line (a span shown as a block, a
 * badge before a sentence) can touch the next word, "live.On a server". A space where an inline
 * element ends and a word or another element starts, or where a sentence runs into one, keeps
 * them apart; a mid-word styled span does not occur on this site.
 */
const spaced = (html: string) =>
  html.replace(/(<\/(?:span|b|strong)>)(?=<span|<b>|<strong|[\p{L}\p{N}])/gu, '$1 ').replace(/([.!?])(?=<span)/g, '$1 ');

const tidy = (markdown: string) =>
  markdown
    .replace(/[ \t]+\n/g, '\n')
    // One space after a list marker; Turndown pads them to four columns.
    .replace(/^(\s*(?:-|\d+\.)) {2,}(?=\S)/gm, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function toMarkdown(html: string, path: string): Page {
  const title = pick(html, /<title>([\s\S]*?)<\/title>/);
  const description = pick(html, /<meta name="description" content="([^"]*)"/);
  const canonical = pick(html, /<link rel="canonical" href="([^"]*)"/) || `${SITE_URL}${path}`;
  const main = spaced(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '');
  const credits = html.match(/<div class="footer-bottom">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const td = converter(canonical);

  const markdown = tidy(
    [
      `# ${title}`,
      `> ${description}`,
      `Web page: ${canonical}`,
      td.turndown(main),
      '---',
      td.turndown(credits),
    ].join('\n\n'),
  );
  return { path, title, description, canonical, markdown: `${markdown}\n` };
}

async function htmlFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('_')) out.push(...(await htmlFiles(root, full)));
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const pathOf = (root: string, file: string) => {
  const rel = relative(root, file).split(sep).join('/').replace(/\.html$/, '');
  const path = `/${rel}`.replace(/\/index$/, '') || '/';
  return path;
};

const order = (a: Page, b: Page) => {
  const rank = (p: Page) => (pageOrder.includes(p.path) ? pageOrder.indexOf(p.path) : pageOrder.length);
  return rank(a) - rank(b) || a.path.localeCompare(b.path);
};

const list = (links: Link[]) => links.map((l) => `- [${l.title}](${l.url}): ${l.text}`).join('\n');

function llmsTxt(pages: Page[]): string {
  return `${[
    '# Darkbeacon',
    `> ${summary}`,
    notes.map((n) => `- ${n}`).join('\n'),
    '## Pages',
    pages.map((p) => `- [${p.title}](${SITE_URL}${markdownPath(p.path)}): ${p.description}`).join('\n'),
    '## Docs',
    list(docs),
    '## App',
    list(app),
    '## Optional',
    list(optional),
  ].join('\n\n')}\n`;
}

function llmsFullTxt(pages: Page[]): string {
  return `${['# Darkbeacon', `> ${summary}`, notes.map((n) => `- ${n}`).join('\n'), ...pages.map((p) => p.markdown.trim())].join(
    '\n\n',
  )}\n`;
}

export default function llms(): AstroIntegration {
  return {
    name: 'darkbeacon:llms',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const pages: Page[] = [];
        for (const file of await htmlFiles(root)) {
          const path = pathOf(root, file);
          if (unlisted.has(path)) continue;
          const page = toMarkdown(await readFile(file, 'utf8'), path);
          await writeFile(join(root, markdownPath(path)), page.markdown);
          pages.push(page);
        }
        pages.sort(order);
        await writeFile(join(root, 'llms.txt'), llmsTxt(pages));
        await writeFile(join(root, 'llms-full.txt'), llmsFullTxt(pages));
        logger.info(`${pages.length} Markdown twins, llms.txt and llms-full.txt`);
      },
    },
  };
}
