// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../ui';
import { AnalyticsClient } from './AnalyticsClient';

type GaWindow = Window & { dataLayer?: IArguments[] };
const calls = () => ((window as GaWindow).dataLayer ?? []).map((args) => Array.from(args));

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as GaWindow).dataLayer;
});

describe('AnalyticsClient', () => {
  it('asks first, sends a reduced page view, and grants analytics storage on Accept', async () => {
    window.history.replaceState(null, '', '/m/secret-chain');
    render(
      <TooltipProvider>
        <AnalyticsClient id="G-TEST1" />
      </TooltipProvider>,
    );
    const accept = await screen.findByRole('button', { name: 'Accept' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customise' })).toBeTruthy();
    expect(calls()).toContainEqual([
      'event',
      'page_view',
      expect.objectContaining({ page_location: `${location.origin}/m/[map]` }),
    ]);
    expect(calls().some(([cmd, kind]) => cmd === 'consent' && kind === 'update')).toBe(false);
    expect(localStorage.getItem('c15t')).toBeNull();
    expect(document.cookie).toBe('');
    expect(document.head.querySelector('script[data-dbk-gtag]')).not.toBeNull();

    await userEvent.click(accept);
    await waitFor(() =>
      expect(calls()).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }]),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull());
    expect(JSON.parse(localStorage.getItem('c15t') ?? '{}').categories.measurement.value).toBe(true);
    expect(JSON.stringify(calls())).not.toContain('secret-chain');
  });
});
