/**
 * Seed butunluk kurali (D7): teklif + urun birlestirmesi domain'de, saf.
 * Bellek okuyucusu ve Mongo seeder ayni fonksiyonu kullanir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { offerIdFor } from '../../src/domain/catalog.js';
import { joinOfferSeeds } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';

/** Senkron fonksiyonun firlattigi hatayi doner; firlatmazsa test duser. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('hata bekleniyordu, firlatilmadi');
}

describe('joinOfferSeeds', () => {
  it('her teklifi urunuyle birlestirir; kimlik turetilir, sira korunur', () => {
    const offers = joinOfferSeeds(CATALOG_SNAPSHOT);

    expect(offers).toHaveLength(CATALOG_SNAPSHOT.offers.length);
    offers.forEach((offer, index) => {
      const seed = CATALOG_SNAPSHOT.offers[index];
      expect(offer).toEqual({
        id: offerIdFor(seed?.marketId ?? '', seed?.productId ?? ''),
        marketId: seed?.marketId,
        product: CATALOG_SNAPSHOT.products.find((product) => product.id === seed?.productId),
        priceMinor: seed?.priceMinor,
        isActive: seed?.isActive,
      });
    });
  });

  it('olmayan urune isaret eden teklif SESSIZCE ATLANMAZ: INTERNAL, hangi ikili oldugu yazar', () => {
    const broken = {
      ...CATALOG_SNAPSHOT,
      offers: [
        ...CATALOG_SNAPSHOT.offers,
        { marketId: 'mkt_migros-jet-moda', productId: 'prd_yok', priceMinor: 100, isActive: true },
      ],
    };

    const join = () => joinOfferSeeds(broken);

    expect(join).toThrow(AppError);
    expect(join).toThrow('mkt_migros-jet-moda -> prd_yok');
    expect(thrownBy(join)).toMatchObject({ code: ERROR_CODES.INTERNAL });
  });
});
