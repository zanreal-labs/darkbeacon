// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type AdminMapDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { AdminMapsTab } from './AdminMaps';

installFlowMocks();
const server = setupMockServer();

const map = (over: Partial<AdminMapDto>): AdminMapDto => ({
  id: 'm1',
  slug: 'home',
  name: 'Home chain',
  description: '',
  ownerAccountId: 'a1',
  ownerName: 'Alice',
  createdAt: 1,
  updatedAt: Date.now(),
  deletedAt: null,
  systems: 12,
  rules: 3,
  ...over,
});

describe('AdminMapsTab', () => {
  it('lists maps with their owners, hides deleted ones until asked and restores them', async () => {
    const maps = [
      map({}),
      map({ id: 'm2', slug: 'old', name: 'Old chain', ownerName: null, deletedAt: Date.now() - 60_000 }),
    ];
    const restored: string[] = [];
    server.use(
      http.get(routes.adminMaps.list.path, () => HttpResponse.json(maps)),
      http.post(buildPath(routes.adminMaps.restore.path, { mapId: 'm2' }), () => {
        restored.push('m2');
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <AdminMapsTab />
        </ToastProvider>
      </TooltipProvider>,
    );

    const list = await screen.findByRole('list', { name: 'Maps' });
    expect(within(list).getByRole('link', { name: 'Home chain' }).getAttribute('href')).toBe('/m/home');
    expect(list.textContent).toContain('Owned by Alice · 12 systems · 3 access rules');
    expect(list.textContent).not.toContain('Old chain');

    await user.click(screen.getByRole('switch', { name: 'Show deleted (1)' }));
    expect(list.textContent).toContain('Old chain');
    expect(list.textContent).toContain('Deleted 1 min ago');
    expect(within(list).queryByRole('link', { name: 'Old chain' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More for Old chain' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(restored).toEqual(['m2']));
  });
});
