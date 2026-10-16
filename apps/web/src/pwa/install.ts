'use client';

import { useSyncExternalStore } from 'react';

/**
 * How this browser can install Darkbeacon, if at all:
 * - `prompt`: Chromium offered it (`beforeinstallprompt`); the menu item calls `prompt()`;
 * - `ios`: Safari (or any browser) on iPhone and iPad, through Share › Add to Home Screen;
 * - `mac-safari`: Safari on macOS, through File › Add to Dock;
 * - `manual`: any other browser: the steps for the usual ones (Chrome/Edge address bar install,
 *   Firefox has none), so the item is never missing where the browser simply has not offered yet;
 * - null: nothing to offer (already installed or switched off).
 */
export type InstallOption = 'prompt' | 'ios' | 'mac-safari' | 'manual' | null;

export interface InstallEnvironment {
  /** The instance serves the manifest (`PWA` is not off). */
  enabled: boolean;
  /** Running as the installed app already. */
  standalone: boolean;
  /** A `beforeinstallprompt` event is held. */
  canPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

export function installOption(env: InstallEnvironment): InstallOption {
  if (!env.enabled || env.standalone) return null;
  if (env.canPrompt) return 'prompt';
  const ua = env.userAgent;
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) return 'ios';
  // Safari on a Mac: any version that can (17+), and when the version is not told, offer it anyway.
  if (
    /Macintosh/.test(ua) &&
    /Safari\//.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)
  ) {
    const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 99);
    return version >= 17 ? 'mac-safari' : 'manual';
  }
  return 'manual';
}

/** Chromium's install event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  enabled: boolean;
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let state: InstallState = { enabled: false, prompt: null, installed: false };
const listeners = new Set<() => void>();
const INITIAL: InstallState = state;

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function setInstallEnabled(enabled: boolean): void {
  if (state.enabled !== enabled) set({ enabled });
}

export function holdInstallPrompt(prompt: BeforeInstallPromptEvent | null): void {
  set({ prompt });
}

export function markInstalled(): void {
  set({ prompt: null, installed: true });
}

/** Asks Chromium to install; the event can be used once, whatever the answer. */
export async function runInstallPrompt(): Promise<void> {
  const prompt = state.prompt;
  if (!prompt) return;
  set({ prompt: null });
  await prompt.prompt();
  if ((await prompt.userChoice).outcome === 'accepted') markInstalled();
}

/** True when this page runs as the installed app (any platform). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => INITIAL,
  );
}

/** What the "Install app" menu item offers in this browser right now. */
export function useInstallOption(): InstallOption {
  const s = useInstallState();
  if (typeof navigator === 'undefined') return null;
  return installOption({
    enabled: s.enabled,
    standalone: s.installed || isStandalone(),
    canPrompt: !!s.prompt,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}
