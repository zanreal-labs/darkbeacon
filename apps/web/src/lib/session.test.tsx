// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { routes } from '@darkbeacon/shared';
import { meFixture } from '../test/fixtures';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { useMe } from './session';

let demoCalls = 0;
const server = setupMockServer(
  http.get(routes.accounts.me.path, () =>
    HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in first.' } }, { status: 401 }),
  ),
  http.post(routes.auth.demo.path, () => {
    demoCalls += 1;
    return HttpResponse.json(meFixture());
  }),
);

function Who() {
  const me = useMe();
  if (me.isPending) return <p>loading</p>;
  return <p>{me.data ? me.data.account.name : 'signed out'}</p>;
}

describe('useMe', () => {
  beforeEach(() => {
    demoCalls = 0;
    sessionStorage.clear();
  });

  it('signs a visit in as the demo account in demo mode', async () => {
    server.use(
      http.get(routes.auth.providers.path, () =>
        HttpResponse.json({ discord: false, eve: false, demo: true }),
      ),
    );
    renderWithProviders(<Who />);
    expect(await screen.findByText(meFixture().account.name)).toBeTruthy();
    expect(demoCalls).toBe(1);
  });

  it('stays signed out without demo mode or after signing out of the demo', async () => {
    server.use(
      http.get(routes.auth.providers.path, () =>
        HttpResponse.json({ discord: true, eve: true, demo: false }),
      ),
    );
    renderWithProviders(<Who />);
    expect(await screen.findByText('signed out')).toBeTruthy();

    sessionStorage.setItem('dbk-demo-signed-out', '1');
    server.use(
      http.get(routes.auth.providers.path, () => HttpResponse.json({ discord: true, eve: true, demo: true })),
    );
    renderWithProviders(<Who />);
    await waitFor(() => expect(screen.getAllByText('signed out')).toHaveLength(2));
    expect(demoCalls).toBe(0);
  });
});
