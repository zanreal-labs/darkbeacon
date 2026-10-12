import type { PassageDto } from '@darkbeacon/shared';
import type { Connection } from '../domain/map.js';
import type { ChainView } from '../domain/stamps.js';
import type { ChainOverlay } from '../ports/index.js';

/**
 * Where the sharing module plugs its merged chains in. Mapping is built first (sharing depends on
 * it), so the overlay is installed later with `use`; until then every map shows its own rows.
 */
export class ChainOverlaySlot implements ChainOverlay {
  private overlay: ChainOverlay | null = null;

  use(overlay: ChainOverlay): void {
    this.overlay = overlay;
  }

  view(mapId: string): Promise<ChainView | null> {
    return this.overlay?.view(mapId) ?? Promise.resolve(null);
  }

  passages(mapId: string, connection: Connection): Promise<PassageDto[]> {
    return this.overlay?.passages?.(mapId, connection) ?? Promise.resolve([]);
  }
}
