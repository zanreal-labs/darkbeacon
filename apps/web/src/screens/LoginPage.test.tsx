// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthProvidersDto } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { TooltipProvider } from '../ui';
import { LoginActions, LoginScreen } from './LoginPage';

setupMockServer();

const redirect = { discordRedirectUrl: 'https://darkbeacon.test/api/auth/discord/callback' };

function renderLogin(
  providers: Omit<AuthProvidersDto, 'discordRedirectUrl'>,
  { next = '/', authError = null as string | null } = {},
) {
  return renderWithProviders(
    <TooltipProvider>
      <LoginScreen
        actions={<LoginActions providers={{ ...providers, ...redirect }} next={next} authError={authError} />}
      />
    </TooltipProvider>,
  );
}

describe('LoginPage', () => {
  it('offers Discord as the one way in, and no sign-in form', () => {
    renderLogin({ discord: true, eve: true, loginMethod: 'discord', demo: false }, { next: '/m/home' });
    const discord = screen.getByRole('link', { name: 'Continue with Discord' });
    expect(discord.getAttribute('href')).toBe('/api/auth/discord/login?returnTo=%2Fm%2Fhome');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/link your EVE characters with EVE SSO/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Explore the demo/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Log in with EVE Online' })).toBeNull();
  });

  it('offers the official EVE Online button where people sign in with EVE', () => {
    renderLogin({ discord: true, eve: true, loginMethod: 'eve', demo: false }, { next: '/m/home' });
    const eve = screen.getByRole('link', { name: 'Log in with EVE Online' });
    expect(eve.getAttribute('href')).toBe('/api/auth/eve/signin?returnTo=%2Fm%2Fhome');
    expect(screen.getByRole('img', { name: 'Log in with EVE Online' }).getAttribute('src')).toMatch(
      /^https:\/\/web\.ccpgamescdn\.com\/eveonlineassets\/developers\/eve-sso-login-/,
    );
    expect(screen.queryByRole('link', { name: 'Continue with Discord' })).toBeNull();
    expect(screen.getByText(/Add your alts on your account page/)).toBeTruthy();
  });

  it('tells the admin what to configure when the sign-in is missing', () => {
    renderLogin({ discord: false, eve: false, loginMethod: 'eve', demo: false });
    expect(screen.getByText("EVE Online sign-in isn't set up yet")).toBeTruthy();
    expect(screen.getByText('EVE_CLIENT_ID')).toBeTruthy();
    renderLogin({ discord: false, eve: false, loginMethod: 'discord', demo: false });
    expect(screen.getByText("Discord sign-in isn't set up yet")).toBeTruthy();
    expect(screen.getByText('https://darkbeacon.test/api/auth/discord/callback')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue with Discord' })).toBeNull();
  });

  it('shows OAuth errors', () => {
    renderLogin(
      { discord: true, eve: true, loginMethod: 'discord', demo: false },
      { authError: 'Discord sign-in was cancelled' },
    );
    expect(screen.getByText('Discord sign-in was cancelled')).toBeTruthy();
  });

  it('lets someone who signed out of the demo step back in', () => {
    renderLogin({ discord: false, eve: false, loginMethod: 'eve', demo: true });
    expect(screen.getByRole('button', { name: /Explore the demo/ })).toBeTruthy();
  });
});
