import { describe, expect, it } from 'vitest';

import { sha256, signV4 } from './sigv4';

/** AWS's published examples: a signature can't match by luck. */
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const EMPTY = sha256('');

describe('signV4', () => {
  it('matches the S3 documentation’s GET Object example', () => {
    expect(
      signV4({
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: {
          range: 'bytes=0-9',
          'x-amz-content-sha256': EMPTY,
          'x-amz-date': '20130524T000000Z',
        },
        payloadHash: EMPTY,
        region: 'us-east-1',
        service: 's3',
        amzDate: '20130524T000000Z',
        credentials,
      }),
    ).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the S3 documentation’s PUT Object example', () => {
    const body = 'Welcome to Amazon S3.';
    expect(sha256(body)).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    expect(
      signV4({
        method: 'PUT',
        url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
        headers: {
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
          'x-amz-content-sha256': sha256(body),
          'x-amz-date': '20130524T000000Z',
        },
        payloadHash: sha256(body),
        region: 'us-east-1',
        service: 's3',
        amzDate: '20130524T000000Z',
        credentials,
      }),
    ).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('matches the S3 documentation’s ListObjects example (query string)', () => {
    expect(
      signV4({
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
        headers: { 'x-amz-content-sha256': EMPTY, 'x-amz-date': '20130524T000000Z' },
        payloadHash: EMPTY,
        region: 'us-east-1',
        service: 's3',
        amzDate: '20130524T000000Z',
        credentials,
      }),
    ).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });
});
