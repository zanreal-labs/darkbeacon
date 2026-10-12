/**
 * IPv4 and IPv6 addresses and CIDR ranges (`203.0.113.0/24`, `2001:db8::/32`, or a single
 * address), for API key IP allow-lists. Pure, no `node:net`, so the web app validates the same way.
 * IPv4-mapped IPv6 addresses (`::ffff:203.0.113.7`) count as their IPv4 address.
 */

export interface IpAddress {
  version: 4 | 6;
  /** 32 or 128 bits, most significant first. */
  bits: bigint;
}

function parseIpv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  if (text.includes('%')) return null; // zone ids are not addresses we compare
  let head = text;
  let tail = '';
  const doubles = text.split('::');
  if (doubles.length > 2) return null;
  if (doubles.length === 2) [head, tail] = doubles as [string, string];
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const pieces = part.split(':');
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      if (i === pieces.length - 1 && piece.includes('.')) {
        const v4 = parseIpv4(piece);
        if (v4 === null) return null;
        groups.push(Number(v4 >> 16n), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };
  const left = toGroups(head);
  const right = toGroups(tail);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (doubles.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...left, ...Array<number>(Math.max(0, missing)).fill(0), ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

const MAPPED_PREFIX = 0xffffn << 32n;

export function parseIp(text: string): IpAddress | null {
  const trimmed = text.trim().replace(/^\[(.*)\]$/, '$1');
  const v4 = parseIpv4(trimmed);
  if (v4 !== null) return { version: 4, bits: v4 };
  const v6 = parseIpv6(trimmed);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn && (v6 & ~0xffffffffn) === MAPPED_PREFIX)
    return { version: 4, bits: v6 & 0xffffffffn };
  return { version: 6, bits: v6 };
}

export interface CidrRange {
  version: 4 | 6;
  base: bigint;
  prefix: number;
}

export function parseCidr(text: string): CidrRange | null {
  const [address, prefixText, ...rest] = text.trim().split('/');
  if (rest.length > 0 || address === undefined) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const width = ip.version === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = prefixText === undefined ? width : Number(prefixText);
  if (prefix > width) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix);
  return { version: ip.version, base: ip.bits & mask, prefix };
}

export function isCidr(text: string): boolean {
  return parseCidr(text) !== null;
}

export function cidrContains(range: CidrRange, ip: IpAddress): boolean {
  if (range.version !== ip.version) return false;
  const width = ip.version === 4 ? 32 : 128;
  const mask = range.prefix === 0 ? 0n : ((1n << BigInt(range.prefix)) - 1n) << BigInt(width - range.prefix);
  return (ip.bits & mask) === range.base;
}

/** True when `address` is inside one of `ranges` (strings that do not parse match nothing). */
export function ipAllowed(ranges: readonly string[], address: string | null): boolean {
  if (ranges.length === 0) return true;
  const ip = address ? parseIp(address) : null;
  if (!ip) return false;
  return ranges.some((r) => {
    const range = parseCidr(r);
    return range !== null && cidrContains(range, ip);
  });
}

/** Loopback, private, link-local and unique-local addresses: a proxy on the same host or network. */
export function isPrivateAddress(address: string): boolean {
  return [
    '127.0.0.0/8',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
    '::1/128',
    'fc00::/7',
    'fe80::/10',
  ].some((r) => ipAllowed([r], address));
}
