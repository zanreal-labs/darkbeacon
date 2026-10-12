// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { ThemePicker } from './ThemePicker';
import { useTheme } from './ThemeProvider';

setupMockServer(http.put(routes.themes.select.path, () => new HttpResponse(null, { status: 401 })));

/** A matchMedia whose `prefers-color-scheme: dark` answer the test flips. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const state = { dark };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') ? state.dark : false;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      state.dark = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

function Current() {
  const { preference, theme } = useTheme();
  return (
    <output>
      {preference}:{theme.id}
    </output>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => delete document.documentElement.dataset.theme);

  it('follows the operating system by default, live', async () => {
    const system = fakeSystem(false);
    renderWithProviders(<Current />);
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'system:default');
    expect(document.documentElement.dataset.theme).toBe('default');

    system.set(true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'system:dark');
  });

  it('moves a choice saved under the old key', () => {
    fakeSystem(false);
    localStorage.setItem('ww-theme-preference', 'dark');
    renderWithProviders(<Current />);
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'dark:dark');
    expect(localStorage.getItem('dbk-theme-preference')).toBe('dark');
    expect(localStorage.getItem('ww-theme-preference')).toBeNull();
  });

  it('keeps an explicit choice when the system changes', async () => {
    const system = fakeSystem(true);
    renderWithProviders(
      <>
        <Current />
        <ThemePicker />
      </>,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Light/ }));
    expect(document.documentElement.dataset.theme).toBe('default');
    system.set(false);
    system.set(true);
    expect(document.documentElement.dataset.theme).toBe('default');
    expect(localStorage.getItem('dbk-theme-preference')).toBe('default');

    await userEvent.click(screen.getByRole('radio', { name: /System/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });
});
