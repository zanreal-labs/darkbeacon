// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes, type UniverseSystemDto } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { AddSystemSearch } from './AddSystemSearch';

const info = (id: number): UniverseSystemDto => ({
  id,
  name: `J${id}`,
  regionName: 'A-R00001',
  constellationName: 'A-C00001',
  security: -0.99,
  whClass: 3,
  statics: [],
  effect: null,
});

setupMockServer(
  http.get(routes.universe.searchSystems.path, () => HttpResponse.json([info(31000001), info(31000002)])),
);

describe('AddSystemSearch with a second way to add (a composite)', () => {
  it('adds a system not on the map “only on this map” from its button or with Shift+Enter', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onPickHere = vi.fn();
    renderWithProviders(
      <AddSystemSearch
        onMap={new Set([31000002])}
        onPick={onPick}
        onPickHere={onPickHere}
        hereLabel="Only on this map"
      />,
    );
    await user.type(screen.getByRole('combobox'), 'J31');
    const fresh = await screen.findByRole('option', { name: /J31000001/ });
    // A system already on the map has no second way: it is found, not added.
    expect(within(screen.getByRole('option', { name: /J31000002/ })).queryByRole('button')).toBeNull();
    await user.click(within(fresh).getByRole('button', { name: 'Only on this map' }));
    expect(onPickHere).toHaveBeenCalledWith(expect.objectContaining({ id: 31000001 }));
    expect(onPick).not.toHaveBeenCalled();

    await user.type(screen.getByRole('combobox'), 'J31');
    await screen.findByRole('option', { name: /J31000001/ });
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onPickHere).toHaveBeenCalledTimes(2);
    await user.type(screen.getByRole('combobox'), 'J31');
    await screen.findByRole('option', { name: /J31000001/ });
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
