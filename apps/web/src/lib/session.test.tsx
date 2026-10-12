// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { routes } from '@darkbeacon/shared';
import { meFixture } from '../test/fixtures';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { meKey, useMe } from './session';

let demoCalls = 0;
const server = setupMockServer(
  http.get(routes.accounts.me.path, () =>
    HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in first.' } }, { status: 401 }),
  ),
  http.get(routes.auth.providers.path, () => HttpResponse.json({ discord: false, eve: false, demo: true })),
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
  });

  it('starts from the account the server rendered the page with', () => {
    const view = renderWithProviders(<p />);
    view.queryClient.setQueryData(meKey, meFixture());
    view.rerender(<Who />);
    expect(screen.getByText(meFixture().account.name)).toBeTruthy();
  });

  it('reads signed out as null and never signs in by itself, even in demo mode', async () => {
    renderWithProviders(<Who />);
    expect(await screen.findByText('signed out')).toBeTruthy();
    expect(demoCalls).toBe(0);
  });

  it('keeps other failures as errors', async () => {
    server.use(http.get(routes.accounts.me.path, () => new HttpResponse(null, { status: 502 })));
    function Failing() {
      const me = useMe();
      return <p>{me.isError ? 'error' : me.isPending ? 'loading' : 'ok'}</p>;
    }
    renderWithProviders(<Failing />);
    expect(await screen.findByText('error')).toBeTruthy();
  });
});
