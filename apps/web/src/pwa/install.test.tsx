// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  holdInstallPrompt,
  installOption,
  markInstalled,
  setInstallEnabled,
  type BeforeInstallPromptEvent,
  type InstallEnvironment,
} from './install';
import { useInstallApp } from './InstallApp';
import { opensInBrowser } from './links';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  // iPadOS asks for the desktop site: a Mac with a touch screen.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macSafari16:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
};

const env = (patch: Partial<InstallEnvironment>): InstallEnvironment => ({
  enabled: true,
  standalone: false,
  canPrompt: false,
  userAgent: UA.chromeWindows,
  maxTouchPoints: 0,
  ...patch,
});

describe('installOption (the "Install app" item)', () => {
  it('shows the browser prompt only once Chromium offered it', () => {
    expect(installOption(env({ canPrompt: false }))).toBeNull();
    expect(installOption(env({ canPrompt: true }))).toBe('prompt');
    expect(installOption(env({ canPrompt: true, userAgent: UA.edge }))).toBe('prompt');
    expect(installOption(env({ canPrompt: true, userAgent: UA.macChrome }))).toBe('prompt');
  });

  it('explains Add to Home Screen on iPhone and iPad, in any browser', () => {
    expect(installOption(env({ userAgent: UA.iphone, maxTouchPoints: 5 }))).toBe('ios');
    expect(installOption(env({ userAgent: UA.iphoneChrome, maxTouchPoints: 5 }))).toBe('ios');
    expect(installOption(env({ userAgent: UA.ipad, maxTouchPoints: 5 }))).toBe('ios');
  });

  it('explains Add to Dock in Safari 17+ on macOS', () => {
    expect(installOption(env({ userAgent: UA.macSafari }))).toBe('mac-safari');
    expect(installOption(env({ userAgent: UA.macSafari16 }))).toBeNull();
    expect(installOption(env({ userAgent: UA.macChrome }))).toBeNull();
    expect(installOption(env({ userAgent: UA.macFirefox }))).toBeNull();
  });

  it('hides it in browsers that cannot install, in the app itself and when switched off', () => {
    expect(installOption(env({ userAgent: UA.firefox }))).toBeNull();
    expect(installOption(env({ canPrompt: true, standalone: true }))).toBeNull();
    expect(installOption(env({ userAgent: UA.iphone, maxTouchPoints: 5, standalone: true }))).toBeNull();
    expect(installOption(env({ canPrompt: true, enabled: false }))).toBeNull();
    expect(installOption(env({ userAgent: UA.macSafari, enabled: false }))).toBeNull();
  });
});

function Item() {
  const install = useInstallApp();
  return (
    <>
      {install.option && <button onClick={install.run}>Install app</button>}
      {install.dialog}
    </>
  );
}

describe('useInstallApp', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      holdInstallPrompt(null);
      setInstallEnabled(false);
    });
    vi.restoreAllMocks();
  });

  it('calls the held prompt, once', async () => {
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    }) as BeforeInstallPromptEvent;
    render(<Item />);
    expect(screen.queryByText('Install app')).toBeNull();
    act(() => {
      setInstallEnabled(true);
      holdInstallPrompt(event);
    });
    await userEvent.click(screen.getByText('Install app'));
    expect(prompt).toHaveBeenCalledOnce();
    // The event is spent; the item goes until Chromium offers again.
    expect(screen.queryByText('Install app')).toBeNull();
  });

  it('shows the Home Screen steps on an iPhone', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.iphone);
    render(<Item />);
    act(() => setInstallEnabled(true));
    await userEvent.click(screen.getByText('Install app'));
    expect(screen.getByRole('dialog', { name: 'Add Darkbeacon to your Home Screen' })).toBeTruthy();
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
  });

  it('shows File › Add to Dock in Safari on a Mac', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.macSafari);
    render(<Item />);
    act(() => setInstallEnabled(true));
    await userEvent.click(screen.getByText('Install app'));
    expect(screen.getByText('File › Add to Dock')).toBeTruthy();
  });

  // Last: the installed flag stays for the page's life.
  it('goes once the app is installed', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.macSafari);
    render(<Item />);
    act(() => setInstallEnabled(true));
    expect(screen.getByText('Install app')).toBeTruthy();
    act(() => markInstalled());
    expect(screen.queryByText('Install app')).toBeNull();
  });
});

describe('opensInBrowser (links in the installed app)', () => {
  const origin = 'https://beacon.example';
  const link = (href: string, target = '', download = false) => ({ href, target, download });

  it('sends other sites to the browser', () => {
    expect(opensInBrowser(link('https://github.com/zanreal-labs/darkbeacon'), origin)).toBe(true);
    expect(opensInBrowser(link('https://zkillboard.com/system/31000005/'), origin)).toBe(true);
    expect(opensInBrowser(link('http://other.example/'), origin)).toBe(true);
  });

  it('keeps this origin, sign-in, new-tab links, downloads and other schemes as they are', () => {
    expect(opensInBrowser(link('/m/home'), origin)).toBe(false);
    expect(opensInBrowser(link('https://beacon.example/jump'), origin)).toBe(false);
    expect(opensInBrowser(link('/api/auth/eve/login'), origin)).toBe(false);
    expect(opensInBrowser(link('https://github.com/', '_blank'), origin)).toBe(false);
    expect(opensInBrowser(link('https://github.com/x.zip', '', true), origin)).toBe(false);
    expect(opensInBrowser(link('mailto:pilot@example.com'), origin)).toBe(false);
    expect(opensInBrowser(link('eve://client/'), origin)).toBe(false);
  });
});
