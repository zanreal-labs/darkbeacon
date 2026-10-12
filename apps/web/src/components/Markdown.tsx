import { Fragment, type ReactNode } from 'react';
import styles from './Markdown.module.css';

/*
 * A small, safe Markdown renderer for notes and comments: paragraphs and line breaks, `#` to `###`
 * headings, bullet and numbered lists, quotes, fenced code, **bold**, *italic*, ~~strike~~,
 * `code`, [links](https://…) and bare http(s) links. It builds React elements (never HTML
 * strings), and only http, https and mailto links are made clickable; they open in a new tab.
 */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      i++;
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.test(lines[i]!)) items.push(list.exec(lines[i++]!)![1]!);
      blocks.push({ kind: list === BULLET ? 'ul' : 'ol', items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    const paragraph: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      ![FENCE, HEADING, BULLET, NUMBERED, QUOTE].some((p) => p.test(lines[i]!))
    )
      paragraph.push(lines[i++]!);
    blocks.push({ kind: 'p', lines: paragraph });
  }
  return blocks;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** The link target when it is safe to open, else null (the text is shown as written). */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : null;
}

// Order matters: code first (nothing inside it is formatted), then links, then emphasis.
const INLINE =
  /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;

export function renderInline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (token.startsWith('`')) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const close = token.indexOf('](');
      const label = token.slice(1, close);
      const href = safeHref(token.slice(close + 2, -1));
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {renderInline(label, k)}
          </a>
        ) : (
          token
        ),
      );
    } else if (/^https?:/i.test(token))
      out.push(
        <a key={k} href={token} target="_blank" rel="noopener noreferrer">
          {token}
        </a>,
      );
    else if (token.startsWith('**') || token.startsWith('__'))
      out.push(<strong key={k}>{renderInline(token.slice(2, -2), k)}</strong>);
    else if (token.startsWith('~~')) out.push(<del key={k}>{renderInline(token.slice(2, -2), k)}</del>);
    else out.push(<em key={k}>{renderInline(token.slice(1, -1), k)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(texts: string[], key: string): ReactNode {
  return texts.map((t, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(t, `${key}-${i}`)}
    </Fragment>
  ));
}

/** Markdown text as React elements; `className` goes on the wrapper. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className ? `${styles.markdown} ${className}` : styles.markdown}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case 'p':
            return <p key={key}>{lines(b.lines, key)}</p>;
          case 'h': {
            const Tag = (['h4', 'h5', 'h6'] as const)[b.level - 1]!;
            return <Tag key={key}>{renderInline(b.text, key)}</Tag>;
          }
          case 'ul':
          case 'ol': {
            const List = b.kind;
            return (
              <List key={key}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </List>
            );
          }
          case 'quote':
            return <blockquote key={key}>{lines(b.lines, key)}</blockquote>;
          case 'code':
            return (
              <pre key={key}>
                <code>{b.text}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
