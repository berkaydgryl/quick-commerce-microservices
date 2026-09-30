import { describe, expect, it } from 'vitest';

import { MARKET_PARAMS, marketPath } from '../../src/features/markets/routes';

describe('marketPath', () => {
  it('market kimligi yola kodlanarak girer', () => {
    expect(marketPath('mkt_migros-jet-moda')).toBe('/markets/mkt_migros-jet-moda');
    expect(marketPath('mkt_a/b')).toBe('/markets/mkt_a%2Fb');
  });

  it('arama verilirse market sayfasi o aramayla acilir (genel aramadaki "+N urun daha")', () => {
    expect(marketPath('mkt_a101-caferaga', 'süt')).toBe('/markets/mkt_a101-caferaga?ara=s%C3%BCt');
  });

  it('parametre adi market sayfasinin okudugu adla ayni (T9.5: ?ara=)', () => {
    const url = new URL(marketPath('mkt_a101-caferaga', 'peynir beyaz'), 'http://x');

    expect(url.searchParams.get(MARKET_PARAMS.search)).toBe('peynir beyaz');
  });
});
