import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { WebhookSender } from '@wormwright/notifications';

/**
 * Addresses a webhook must not reach unless the admin allows private networks. Two lists,
 * because BlockList also matches IPv4 addresses against IPv6 rules such as `::/96`.
 */
const PRIVATE_V4 = new BlockList();
const PRIVATE_V6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network, unspecified
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  PRIVATE_V4.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10],
  ['ff00::', 8], // multicast
] as const) {
  PRIVATE_V6.addSubnet(net, prefix, 'ipv6');
}

/** True for a routable public IP address; false for private, local, reserved ones and non-IPs. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, 'ipv4');
  return family === 6 && !PRIVATE_V6.check(address, 'ipv6');
}

export interface HttpWebhookSenderOptions {
  /** Whether webhooks may reach private networks (an instance setting). Default: never. */
  allowPrivate?: () => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * POSTs webhook bodies. Redirects are not followed and a receiver gets 10 s to answer.
 * Unless private networks are allowed, the target's addresses are checked in the DNS lookup
 * the connection itself uses, so a name cannot resolve to a public address for a check and to
 * an internal one for the request.
 */
export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly options: HttpWebhookSenderOptions = {}) {}

  async post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }> {
    const allowPrivate = (await this.options.allowPrivate?.()) ?? false;
    const target = new URL(url);
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    if (!allowPrivate && isIP(host) !== 0 && !isPublicAddress(host)) throw privateTarget(host);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const request = send(
        target,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
          // A fresh connection per delivery, so every connection goes through the lookup below.
          agent: false,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          ...(allowPrivate ? {} : { lookup: publicOnlyLookup }),
        },
        (response) => {
          // The body is never shown to anyone.
          response.resume();
          resolve({ status: response.statusCode ?? 0 });
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  }
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    options,
    (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => {
      if (error) return callback(error, address as string, family);
      const addresses = typeof address === 'string' ? [address] : address.map((a) => a.address);
      const refused = addresses.find((a) => !isPublicAddress(a));
      if (refused !== undefined)
        return callback(privateTarget(`${hostname} (${refused})`), address as string, family);
      callback(null, address as string, family);
    },
  );
};

function privateTarget(what: string): Error {
  return new Error(`${what} is a private or local address; an admin can allow private networks`);
}
