// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown, parseBlocks, safeHref } from './Markdown';

describe('Markdown', () => {
  it('splits blocks: headings, lists, quotes, code and paragraphs', () => {
    expect(
      parseBlocks('# Title\nfirst line\nsecond line\n\n- a\n- b\n1. one\n> quoted\n```\nx = 1\n```'),
    ).toEqual([
      { kind: 'h', level: 1, text: 'Title' },
      { kind: 'p', lines: ['first line', 'second line'] },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['one'] },
      { kind: 'quote', lines: ['quoted'] },
      { kind: 'code', text: 'x = 1' },
    ]);
  });

  it('renders emphasis, code and safe links that open in a new tab', () => {
    const { container } = render(
      <Markdown
        text={'**Keepstar** in *range*, `code`, [zkill](https://zkillboard.com) and https://eve.example/x.'}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Keepstar');
    expect(container.querySelector('em')?.textContent).toBe('range');
    expect(container.querySelector('code')?.textContent).toBe('code');
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://zkillboard.com',
      'https://eve.example/x',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('never makes script links clickable and never renders HTML', () => {
    const { container } = render(<Markdown text={'[x](javascript:alert(1)) <b>raw</b>'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>raw</b>');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('data:text/html,x')).toBeNull();
  });
});
