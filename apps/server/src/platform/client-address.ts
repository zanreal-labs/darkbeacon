import { isPrivateAddress, parseIp } from '@darkbeacon/shared';

/**
 * The client's address for IP allow-lists and rate limits. `X-Forwarded-For` is only believed
 * as far as it was added by proxies on a private network or this host: walking it from the
 * right, the first address that is not private is the client. A client that reaches the server
 * directly cannot make itself someone else by sending the header, because its own (public)
 * socket address is used then.
 */
export function clientAddress(
  socketAddress: string | null | undefined,
  forwardedFor: string | string[] | undefined,
): string | null {
  const socket = normalize(socketAddress);
  if (!socket || !isPrivateAddress(socket)) return socket;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  if (!header) return socket;
  const hops = header
    .split(',')
    .map((h) => normalize(h.trim()))
    .filter((h): h is string => h !== null);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isPrivateAddress(hops[i]!)) return hops[i]!;
  }
  return hops[0] ?? socket;
}

function normalize(address: string | null | undefined): string | null {
  if (!address) return null;
  const ip = parseIp(address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1'));
  if (!ip) return null;
  return address.replace(/^\[|\]$/g, '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
}
