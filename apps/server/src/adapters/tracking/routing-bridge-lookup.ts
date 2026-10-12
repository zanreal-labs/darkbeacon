import type { BridgeRepository } from '@darkbeacon/routing';
import type { BridgeLookup } from '@darkbeacon/tracking';

/** Tracking's view of routing's Ansiblex list: is this pair a known bridge on the map? */
export class RoutingBridgeLookup implements BridgeLookup {
  constructor(private readonly bridges: Pick<BridgeRepository, 'list'>) {}

  async linked(mapId: string, a: number, b: number): Promise<boolean> {
    return (await this.bridges.list(mapId)).some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  }
}
