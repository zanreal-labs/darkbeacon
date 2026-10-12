// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes, type ApiKeyDto, type CreateApiKeyRequest, type MapSummaryDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { ApiKeysCard } from './ApiKeysCard';

// Radix measures controls with ResizeObserver, which jsdom lacks.
installFlowMocks();
const server = setupMockServer();

const maps: MapSummaryDto[] = [
  { id: 'm-home', slug: 'home', name: 'Home chain', role: 'admin' },
  { id: 'm-stage', slug: 'stage', name: 'Staging', role: 'member' },
];

const TOKEN = 'dbk_pat_3fZsecretsecretsecret';

function keyOf(body: CreateApiKeyRequest): ApiKeyDto {
  return {
    id: 'k1',
    kind: 'pat',
    name: body.name,
    prefix: 'dbk_pat_3fZ',
    scopes: body.scopes,
    readOnly: body.readOnly ?? false,
    expiresAt: body.expiresAt ?? null,
    allowedIps: body.allowedIps ?? [],
    rateLimitPerMinute: body.rateLimitPerMinute ?? null,
    ownerAccountId: 'a1',
    createdBy: { accountId: 'a1', name: 'Alice' },
    instanceRole: null,
    mapGrants: [],
    allMapsRole: null,
    maps: [{ id: 'm-home', name: 'Home chain', slug: 'home' }],
    status: 'active',
    createdAt: 1,
    rotatedAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
  };
}

function serve() {
  const keys: ApiKeyDto[] = [];
  const bodies: CreateApiKeyRequest[] = [];
  server.use(
    http.get(routes.accounts.me.path, () =>
      HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in' } }, { status: 401 }),
    ),
    http.get(routes.maps.list.path, () => HttpResponse.json(maps)),
    http.get(routes.apiKeys.list.path, () => HttpResponse.json(keys)),
    http.post(routes.apiKeys.create.path, async ({ request }) => {
      const body = (await request.json()) as CreateApiKeyRequest;
      bodies.push(body);
      const key = keyOf(body);
      keys.push(key);
      return HttpResponse.json({ key, token: TOKEN }, { status: 201 });
    }),
  );
  return bodies;
}

function renderCard() {
  return renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <ApiKeysCard />
      </ToastProvider>
    </TooltipProvider>,
  );
}

describe('ApiKeysCard', () => {
  it('makes a key for maps picked by name and shows its token once', async () => {
    const bodies = serve();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'New key' }));
    const dialog = await screen.findByRole('dialog', { name: 'New API key' });
    await user.type(within(dialog).getByLabelText('Name'), 'Spreadsheet');
    await user.click(within(dialog).getByRole('radio', { name: /Only the maps I pick/ }));
    await user.type(within(dialog).getByPlaceholderText('Search your maps by name'), 'home');
    await user.click(await within(dialog).findByRole('option', { name: /Home chain/ }));
    // The summary speaks names, never ids.
    const summary = within(dialog).getByRole('list', { name: 'What the key can do' });
    expect(summary.textContent).toContain('Read everything on Home chain');
    expect(dialog.textContent).not.toContain('m-home');

    await user.click(within(dialog).getByRole('button', { name: 'Make key' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      name: 'Spreadsheet',
      scopes: ['map:m-home:*:read', 'account:read', 'universe:read'],
      readOnly: false,
      allowedIps: [],
      rateLimitPerMinute: null,
    });
    expect(bodies[0]!.expiresAt).toBeGreaterThan(Date.now() + 89 * 86_400_000);

    // The token, once, with a ready-made example.
    const shown = await screen.findByRole('dialog', { name: 'Spreadsheet is ready' });
    expect(shown.textContent).toContain('It will not be shown again');
    expect(within(shown).getByText(TOKEN)).toBeTruthy();
    expect(shown.textContent).toContain(`curl -H "Authorization: Bearer ${TOKEN}"`);
    await user.click(within(shown).getByRole('button', { name: 'I saved it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain(TOKEN);

    // The list shows the key by name, its prefix and what it may do, maps by name.
    expect(await screen.findByText('Spreadsheet')).toBeTruthy();
    expect(document.body.textContent).toContain('dbk_pat_3fZ…');
    expect(document.body.textContent).toContain('Read everything on Home chain');
    expect(document.body.textContent).not.toContain('m-home');
  });

  it('makes a key for every map with the preset', async () => {
    const bodies = serve();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New key' }));
    const dialog = await screen.findByRole('dialog', { name: 'New API key' });
    await user.type(within(dialog).getByLabelText('Name'), 'Bot');
    await user.click(within(dialog).getByRole('radio', { name: /^Mapper/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Make key' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.scopes).toEqual([
      '*:read',
      'systems:write',
      'connections:write',
      'signatures:write',
      'account:read',
      'universe:read',
    ]);
  });
});
