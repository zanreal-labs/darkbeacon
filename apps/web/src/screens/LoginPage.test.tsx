// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthProvidersDto } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { TooltipProvider } from '../ui';
import { LoginActions, LoginScreen } from './LoginPage';

setupMockServer();

function renderLogin(providers: AuthProvidersDto, { next = '/', authError = null as string | null } = {}) {
  return renderWithProviders(
    <TooltipProvider>
      <LoginScreen
        actions={
          <LoginActions
            providers={providers}
            next={next}
            authError={authError}
            redirectUrl="https://darkbeacon.test/api/auth/discord/callback"
          />
        }
      />
    </TooltipProvider>,
  );
}

describe('LoginPage', () => {
  it('offers Discord as the one way in, and no sign-in form', () => {
    renderLogin({ discord: true, eve: true, demo: false }, { next: '/m/home' });
    const discord = screen.getByRole('link', { name: 'Continue with Discord' });
    expect(discord.getAttribute('href')).toBe('/api/auth/discord/login?returnTo=%2Fm%2Fhome');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/link your EVE characters with EVE SSO/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Explore the demo/ })).toBeNull();
  });

  it('tells the admin what to configure when Discord is missing', () => {
    renderLogin({ discord: false, eve: false, demo: false });
    expect(screen.getByText("Discord sign-in isn't set up yet")).toBeTruthy();
    expect(screen.getByText('DISCORD_CLIENT_ID')).toBeTruthy();
    expect(screen.getByText('https://darkbeacon.test/api/auth/discord/callback')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue with Discord' })).toBeNull();
  });

  it('shows OAuth errors', () => {
    renderLogin({ discord: true, eve: true, demo: false }, { authError: 'Discord sign-in was cancelled' });
    expect(screen.getByText('Discord sign-in was cancelled')).toBeTruthy();
  });

  it('lets someone who signed out of the demo step back in', () => {
    renderLogin({ discord: false, eve: false, demo: true });
    expect(screen.getByRole('button', { name: /Explore the demo/ })).toBeTruthy();
  });
});
