// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { TooltipProvider } from '../ui';
import { LoginPage } from './LoginPage';

const unauthenticated = http.get(routes.accounts.me.path, () =>
  HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in first.' } }, { status: 401 }),
);
const server = setupMockServer(unauthenticated);

function renderLogin(path = '/login') {
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }], { initialEntries: [path] });
  return renderWithProviders(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
}

describe('LoginPage', () => {
  it('offers Discord as the one way in, and no sign-in form', async () => {
    server.use(
      http.get(routes.auth.providers.path, () =>
        HttpResponse.json({ discord: true, eve: true, demo: false }),
      ),
    );
    renderLogin('/login?next=/m/home');
    const discord = await screen.findByRole('link', { name: 'Continue with Discord' });
    expect(discord.getAttribute('href')).toBe('/api/auth/discord/login?returnTo=%2Fm%2Fhome');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/link your EVE characters with EVE SSO/)).toBeTruthy();
  });

  it('tells the admin what to configure when Discord is missing', async () => {
    server.use(
      http.get(routes.auth.providers.path, () =>
        HttpResponse.json({ discord: false, eve: false, demo: false }),
      ),
    );
    renderLogin();
    expect(await screen.findByText("Discord sign-in isn't set up yet")).toBeTruthy();
    expect(screen.getByText('DISCORD_CLIENT_ID')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue with Discord' })).toBeNull();
  });

  it('shows OAuth errors', async () => {
    server.use(
      http.get(routes.auth.providers.path, () =>
        HttpResponse.json({ discord: true, eve: true, demo: false }),
      ),
    );
    renderLogin('/login?auth_error=Discord%20sign-in%20was%20cancelled');
    expect(await screen.findByText('Discord sign-in was cancelled')).toBeTruthy();
  });
});
