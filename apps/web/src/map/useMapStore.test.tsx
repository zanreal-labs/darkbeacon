// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type MapSystemDto, type StreamSnapshotDto } from '@darkbeacon/shared';
import { connectionFixture, eventMessage, MAP_ID, systemFixture } from '../test/fixtures';
import { FakeSocket, fakeRealtime, renderWithProviders, setupMockServer } from '../test/setup';
import { useMapStore } from './useMapStore';

const SYSTEM = 31000001;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const STREAM = `map:${MAP_ID}`;
const updatePath = buildPath(routes.systems.update.path, { mapId: MAP_ID, solarSystemId: SYSTEM });
const removePath = buildPath(routes.systems.remove.path, { mapId: MAP_ID, solarSystemId: SYSTEM });
const server = setupMockServer();

function Probe({ initial }: { initial?: StreamSnapshotDto }) {
  const store = useMapStore(MAP_ID, initial);
  const system = store.state.systems.get(SYSTEM);
  return (
    <div>
      <p data-testid="status">{system?.status ?? 'none'}</p>
      <p data-testid="connections">{store.state.connections.size}</p>
      <p data-testid="pending">{store.pendingCount}</p>
      <button onClick={() => void store.updateSystem(SYSTEM, { status: 'hostile' })}>hostile</button>
      <button onClick={() => void store.removeSystem(SYSTEM)}>remove</button>
      {store.notices.map((n) => (
        <p key={n.id} role="alert">
          {n.message}
        </p>
      ))}
    </div>
  );
}

function start(system: MapSystemDto = systemFixture(SYSTEM)) {
  const realtime = fakeRealtime();
  const view = renderWithProviders(<Probe />, { realtime });
  const socket = FakeSocket.last!;
  act(() => socket.open());
  act(() =>
    socket.push({
      op: 'snapshot',
      stream: STREAM,
      seq: 0,
      data: { systems: [system, systemFixture(2)], connections: [connectionFixture('c1', SYSTEM, 2)] },
    }),
  );
  return { ...view, socket };
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useMapStore optimistic updates', () => {
  it('rolls a rejected change back and tells the user why', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.patch(updatePath, async () => {
        await gate;
        return HttpResponse.json(
          { error: { code: 'forbidden', message: 'You are a viewer on this map.' } },
          { status: 403 },
        );
      }),
    );
    const user = userEvent.setup();
    start();
    expect(text('status')).toBe('unknown');

    await user.click(screen.getByRole('button', { name: 'hostile' }));
    // Shown at once, before the server answered.
    expect(text('status')).toBe('hostile');
    expect(text('pending')).toBe('1');

    await act(async () => {
      release();
      await gate;
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not update the system: You are a viewer on this map.',
    );
    expect(text('status')).toBe('unknown');
    expect(text('pending')).toBe('0');
  });

  it('restores a removed system and its connections when the server refuses', async () => {
    server.use(
      http.delete(removePath, () =>
        HttpResponse.json({ error: { code: 'conflict', message: 'The system is locked.' } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'remove' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not remove the system: The system is locked.',
    );
    expect(text('status')).toBe('unknown');
    expect(text('connections')).toBe('1');
  });

  it('keeps an accepted change until its event arrives, then shows the server state', async () => {
    server.use(
      http.patch(updatePath, async () => {
        await delay(10);
        return HttpResponse.json(systemFixture(SYSTEM, { status: 'hostile', updatedAt: 2 }));
      }),
    );
    const user = userEvent.setup();
    const { socket } = start();
    await user.click(screen.getByRole('button', { name: 'hostile' }));
    await act(() => delay(30));
    // Request done, event not here yet: still shown as hostile.
    expect(text('status')).toBe('hostile');
    expect(text('pending')).toBe('1');

    act(() =>
      socket.push(
        eventMessage(STREAM, 'system.updated', systemFixture(SYSTEM, { status: 'hostile', updatedAt: 2 })),
      ),
    );
    expect(text('pending')).toBe('0');
    expect(text('status')).toBe('hostile');

    // A later change from someone else wins.
    act(() =>
      socket.push(
        eventMessage(STREAM, 'system.updated', systemFixture(SYSTEM, { status: 'friendly', updatedAt: 3 })),
      ),
    );
    expect(text('status')).toBe('friendly');
  });
});

describe('useMapStore with a server-rendered snapshot', () => {
  it('shows the snapshot at once and only takes events after its seq', () => {
    const initial: StreamSnapshotDto = {
      stream: STREAM,
      seq: 7,
      data: { systems: [systemFixture(SYSTEM, { status: 'friendly' })], connections: [] },
    };
    renderWithProviders(<Probe initial={initial} />, { realtime: fakeRealtime() });
    // Painted before any socket opened.
    expect(text('status')).toBe('friendly');
    const socket = FakeSocket.last!;
    act(() => socket.open());
    expect(socket.sent).toEqual([{ op: 'subscribe', stream: STREAM, sinceSeq: 7 }]);
    const message = eventMessage(STREAM, 'system.updated', systemFixture(SYSTEM, { status: 'hostile' }));
    act(() => socket.push({ ...message, event: { ...message.event, seq: 8 } }));
    expect(text('status')).toBe('hostile');
  });
});
