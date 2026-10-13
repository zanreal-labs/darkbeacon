// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { wormholeCatalogFixture } from '../test/wormholes';
import { TooltipProvider } from '../ui';
import { closeWormholeReference, openWormholeReference } from './open';
import {
  TypeReferenceButton,
  WormholeReferenceHost,
  WormholeReferenceRailButton,
} from './WormholeReferenceHost';

setupMockServer(http.get(routes.universe.wormholes.path, () => HttpResponse.json(wormholeCatalogFixture())));

afterEach(() => act(() => closeWormholeReference()));

function view() {
  return renderWithProviders(
    <TooltipProvider>
      <WormholeReferenceRailButton />
      <input aria-label="Notes" />
      <table>
        <tbody>
          <tr>
            <td>
              <TypeReferenceButton code="U210">U210 LS</TypeReferenceButton>
            </td>
          </tr>
        </tbody>
      </table>
      <WormholeReferenceHost />
    </TooltipProvider>,
  );
}

// The dialog's module loads on first opening.
const dialog = () => screen.findByRole('dialog', { name: 'Wormhole types' }, { timeout: 5000 });
const shownCodes = (root: HTMLElement) =>
  [...root.querySelectorAll('tbody tr[data-code]')].map((r) => r.getAttribute('data-code'));

describe('the wormhole types reference', () => {
  it('opens from the rail with every type, its size, and the size legend', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Wormhole types' }));
    const d = await dialog();
    await waitFor(() => expect(shownCodes(d).length).toBe(wormholeCatalogFixture().types.length));
    const row = d.querySelector('tr[data-code="C247"]') as HTMLElement;
    expect(within(row).getByText('C3')).toBeTruthy();
    expect(within(row).getByText('C4')).toBeTruthy();
    expect(within(row).getByText('16 h')).toBeTruthy();
    expect(within(row).getByText('2 000 000 t')).toBeTruthy();
    expect(within(row).getByText('375 000 t')).toBeTruthy();
    expect(within(row).getByText('L')).toBeTruthy();
    expect(within(row).getByText('static')).toBeTruthy();
    const legend = d.querySelector('dl[aria-label="Ship sizes"]') as HTMLElement;
    expect(within(legend).getByText('up to Cruisers, Battlecruisers, Industrials')).toBeTruthy();
    expect(within(legend).getByText('Frigates, Destroyers')).toBeTruthy();
  });

  it('searches by code and class, and keeps statics only', async () => {
    view();
    act(() => openWormholeReference());
    const d = await dialog();
    const search = await within(d).findByRole('textbox', { name: 'Search wormhole types' });
    await userEvent.type(search, 'C247');
    await waitFor(() => expect(shownCodes(d)).toEqual(['C247']));
    await userEvent.clear(search);
    await userEvent.type(search, 'thera');
    await waitFor(() => expect(shownCodes(d)).toContain('F135'));
    await userEvent.clear(search);
    await userEvent.click(within(d).getByRole('switch', { name: 'Statics only' }));
    await waitFor(() => expect(shownCodes(d)).not.toContain('A009'));
    expect(shownCodes(d)).toContain('U210');
    expect(d.querySelector('[aria-live]')?.textContent).toMatch(/^\d+ of \d+ types$/);
  });

  it('sorts by a column header', async () => {
    view();
    act(() => openWormholeReference());
    const d = await dialog();
    await waitFor(() => expect(shownCodes(d).length).toBeGreaterThan(0));
    await userEvent.click(within(d).getByRole('button', { name: /Max \/ jump/ }));
    const header = within(d).getByRole('columnheader', { name: /Max \/ jump/ });
    expect(header.getAttribute('aria-sort')).toBe('descending');
    const first = shownCodes(d)[0]!;
    expect(d.querySelector(`tr[data-code="${first}"]`)?.textContent).toContain('2 000 000 t');
    expect(shownCodes(d).at(-1)).toBe('K162');
  });

  it('opens at the type of a signature, and from the W key unless typing', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'U210 LS' }));
    const d = await dialog();
    await waitFor(() => expect(shownCodes(d)).toEqual(['U210']));
    expect(
      (within(d).getByRole('textbox', { name: 'Search wormhole types' }) as HTMLInputElement).value,
    ).toBe('U210');
    act(() => closeWormholeReference());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'w');
    expect(screen.queryByRole('dialog')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('w');
    const again = await dialog();
    await waitFor(() => expect(shownCodes(again).length).toBeGreaterThan(1));
  });
});
