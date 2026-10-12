// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes, type OAuthAuthorizeDecision, type OAuthAuthorizeQuery } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { TooltipProvider } from '../ui';
import { OAuthConsent } from './OAuthConsent';

installFlowMocks();
const server = setupMockServer();

const query: OAuthAuthorizeQuery = {
  response_type: 'code',
  client_id: 'https://desk.example/client.json',
  redirect_uri: 'https://desk.example/callback',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  state: 'xyz',
};

const assign = vi.fn();
const realLocation = window.location;

function renderConsent() {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
  return renderWithProviders(
    <TooltipProvider>
      <OAuthConsent
        query={query}
        request={{
          client: { id: query.client_id, name: 'Desk', kind: 'metadata', uri: 'https://desk.example' },
          redirectHost: 'desk.example',
          scopes: ['*:read', 'account:read'],
          resource: 'https://darkbeacon.test/mcp',
        }}
        maps={[
          { id: 'm-home', slug: 'home', name: 'Home chain', role: 'admin' },
          { id: 'm-stage', slug: 'stage', name: 'Staging', role: 'viewer' },
        ]}
        accountName="Alice"
      />
    </TooltipProvider>,
  );
}

describe('OAuthConsent', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    assign.mockReset();
  });

  it('allows the client on maps picked by name, read-only, and follows the answer', async () => {
    const bodies: OAuthAuthorizeDecision[] = [];
    server.use(
      http.post(routes.oauth.decide.path, async ({ request }) => {
        bodies.push((await request.json()) as OAuthAuthorizeDecision);
        return HttpResponse.json({ redirectTo: 'https://desk.example/callback?code=c&state=xyz' });
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsent();
    expect(screen.getByText('Desk wants to use Darkbeacon as you')).toBeTruthy();
    expect(document.body.textContent).toContain('sent back to desk.example');
    expect(document.body.textContent).toContain('Read everything on all your maps');

    await user.click(screen.getByRole('radio', { name: /Only these maps/ }));
    await user.type(screen.getByPlaceholderText('Search your maps by name'), 'stag');
    await user.click(await screen.findByRole('option', { name: /Staging/ }));
    await user.click(screen.getByRole('switch', { name: /Read only/ }));
    await user.click(screen.getByRole('button', { name: 'Allow' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://desk.example/callback?code=c&state=xyz'),
    );
    expect(bodies).toEqual([{ ...query, approve: true, maps: ['m-stage'], readOnly: true }]);
  });

  it('shows a refusal and stays on the page', async () => {
    server.use(
      http.post(routes.oauth.decide.path, () =>
        HttpResponse.json(
          { error: { code: 'bad_request', message: 'The request expired' } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsent();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('The request expired')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
