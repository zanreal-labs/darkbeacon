import type { WormholeDestination } from '@darkbeacon/shared';
import type { TokenName } from '@darkbeacon/theme-sdk';

/** Colour of a destination: the same tokens as the class labels of the systems it leads to. */
export function destinationToken(destination: WormholeDestination | null): TokenName {
  switch (destination) {
    case 'hs':
      return 'security-high';
    case 'ls':
      return 'security-low';
    case 'ns':
      return 'security-null';
    case null:
      return 'color-text-muted';
    default:
      return destination.startsWith('c') && destination.length === 2
        ? 'security-wormhole'
        : 'security-special';
  }
}
