import { describe, expect, it } from 'vitest';

import { isPublicAddress } from './net';

describe('isPublicAddress', () => {
  it('refuses private, internal and special addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '64:ff9b::7f00:1',
      'not an address',
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700::1111'])
      expect(isPublicAddress(ip), ip).toBe(true);
  });
});
