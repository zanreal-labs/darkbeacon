// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { darkTheme, themeToCss } from '@darkbeacon/theme-sdk';
import { themeHeadScript, themeStyles } from './head';

/** Runs the inline <head> script the way the browser does, before anything else on the page. */
function runHeadScript() {
  new Function(themeHeadScript)();
}

const root = document.documentElement;

describe('theme head script', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'dbk_theme=; Max-Age=0; Path=/';
    root.removeAttribute('data-theme');
    document.getElementById('dbk-package-themes')?.remove();
  });
  afterEach(() => root.removeAttribute('data-theme'));

  it('leaves `system` to the CSS media queries', () => {
    runHeadScript();
    expect(root.hasAttribute('data-theme')).toBe(false);
    document.cookie = 'dbk_theme=system; Path=/';
    runHeadScript();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('applies an explicit choice from the cookie before anything else', () => {
    localStorage.setItem('dbk-theme-preference', 'default');
    document.cookie = 'dbk_theme=dark; Path=/';
    runHeadScript();
    expect(root.dataset.theme).toBe('dark');
  });

  it('falls back to the browser copy and to the key from before the rename', () => {
    localStorage.setItem('dbk-theme-preference', 'contrast');
    runHeadScript();
    expect(root.dataset.theme).toBe('contrast');
    localStorage.clear();
    localStorage.setItem('ww-theme-preference', 'dark');
    runHeadScript();
    expect(root.dataset.theme).toBe('dark');
  });

  it('applies a theme package only with its saved CSS', () => {
    document.cookie = 'dbk_theme=nebula; Path=/';
    runHeadScript();
    expect(root.hasAttribute('data-theme')).toBe(false);

    localStorage.setItem(
      'dbk-theme-css',
      themeToCss({ ...darkTheme, id: 'nebula' }, '[data-theme="nebula"]'),
    );
    runHeadScript();
    expect(root.dataset.theme).toBe('nebula');
    expect(document.getElementById('dbk-package-themes')?.textContent).toContain('[data-theme="nebula"]');
  });

  it('never throws, even without storage', () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      document.cookie = 'dbk_theme=dark; Path=/';
      expect(runHeadScript).not.toThrow();
      expect(root.dataset.theme).toBe('dark');
    } finally {
      Object.defineProperty(window, 'localStorage', storage);
    }
  });

  it('ships every built-in theme and the system media queries in the stylesheet', () => {
    expect(themeStyles).toContain('[data-theme="contrast"]');
    expect(themeStyles).toContain('@media (prefers-color-scheme: dark)');
  });
});
