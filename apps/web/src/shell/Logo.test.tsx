// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { beamPath, LogoMark, MARK } from './Logo';

// Tests run from the repository root (see vitest.config.ts).
const publicFile = (name: string) => readFileSync(join(process.cwd(), 'apps/web/public', name), 'utf8');

describe('LogoMark', () => {
  it('draws the ring with a break where the beam leaves it, in theme colours', () => {
    const { container } = render(<LogoMark size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const ring = svg.querySelector(`circle[r="${MARK.ring}"]`)!;
    expect(ring.getAttribute('mask')).toMatch(/^url\(#dbk-mark-gap-/);
    expect(svg.querySelector('mask path')!.getAttribute('d')).toBe(beamPath(MARK.gap));
    expect(svg.querySelector(`path[d="${beamPath()}"]`)!.getAttribute('fill')).toMatch(
      /^url\(#dbk-mark-fade-/,
    );
    expect(svg.dataset.animated).toBeUndefined();
  });

  it('can be one colour and animated', () => {
    const { container } = render(<LogoMark tone="mono" animated />);
    const svg = container.querySelector('svg')!;
    expect(svg.dataset.animated).toBe('true');
    expect(svg.querySelector(`path[d="${beamPath()}"]`)!.getAttribute('fill')).toBe('currentColor');
  });

  it('matches the static icons built by tools/icons', () => {
    for (const file of ['favicon.svg', 'icons/mark.svg']) {
      const svg = publicFile(file);
      expect(svg).toContain(`d="${beamPath()}"`);
      expect(svg).toContain(`d="${beamPath(MARK.gap)}"`);
      expect(svg).toContain(`r="${MARK.ring}"`);
      expect(svg).toContain(`r="${MARK.core}"`);
    }
  });
});
