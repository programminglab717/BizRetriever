import dns from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Where webhooks may be sent (M16, ADR-066): public internet addresses only. The check runs on
 * the address actually connected to (a `lookup` for the request), so a name that resolves to a
 * private address, or changes to one after the webhook was saved, is refused at sending time.
 */

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 127], // :: and ::1
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** Whether an IP address is on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  if (family === 4) return !blocked.check(ip, 'ipv4');
  // An IPv4 address written as IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) is judged as IPv4.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const n = (parseInt(mapped[1]!, 16) << 16) | parseInt(mapped[2]!, 16);
    return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return !blocked.check(ip, 'ipv6');
}

export class BlockedAddressError extends Error {
  readonly code = 'EBLOCKED';
  constructor(host: string) {
    super(`${host} is a private or internal address`);
  }
}

/** A `lookup` for http(s).request that refuses private addresses (all of them must be public). */
export function publicOnlyLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses;
      if (!allowPrivate && (list.length === 0 || list.some((a) => !isPublicAddress(a.address))))
        return callback(new BlockedAddressError(hostname), '', 4);
      if (options.all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };
}
