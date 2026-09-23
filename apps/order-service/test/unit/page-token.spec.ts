import { describe, expect, it } from 'vitest';

import { decodePageToken, encodePageToken } from '../../src/interfaces/grpc/page-token.js';

describe('sayfa jetonu', () => {
  it('imlec jetona ve geri ayni imlece cevrilir', () => {
    const cursor = {
      createdAt: new Date(1_760_000_000_123),
      orderId: 'ord_db77f4c0e24f49919cc1d78a649c9c94',
    };

    expect(decodePageToken(encodePageToken(cursor))).toEqual(cursor);
  });

  it('bu sunucunun uretmedigi jeton null', () => {
    const forged = Buffer.from('dun.ord_1', 'utf8').toString('base64url');

    for (const token of ['uydurma', forged, Buffer.from('.ord_1').toString('base64url')]) {
      expect(decodePageToken(token)).toBeNull();
    }
  });
});
