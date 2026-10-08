/**
 * QA kara kutu (T15.2, catalog geriye donuk PR 1; CQ3): siparisin fiyat kaynagi uctan uca. order'in
 * GERCEK catalog istemcisi (GrpcCatalogPricing) GERCEK catalog'a (Mongo, fixture katalog; bir teklif
 * pasife cekilmis) baglanir; fiyatlama order'in saf priceDraft'i. catalog QA destegi app'ler arasi
 * (mevcut QA pratigi).
 *
 *   P1 activeOffers: yalniz o marketin AKTIF teklifleri; pasif, baska marketin ve olmayan urun yok;
 *      tekrarlanan kimlik tek teklif; sku, ad, birim, fiyat ve para birimi seed'le birebir. Ham
 *      BatchGetOffers'ta pasif urun `missing`'de (sozlesme: sira garantisi yok, siralanarak).
 *   P2 marketRules (#154, #203): acik market {isOpen, kurallar, konum, yaricap} seed'le birebir;
 *      fixture'in kapali marketi YALNIZ {isOpen: false} (kurallari okunmaz).
 *   P3 priceDraft: pasif urunlu sepet VALIDATION_FAILED (unavailableProductIds yalniz o urun); pasifsiz
 *      sepetin ara toplami adet x seed fiyati, kuponsuz indirim 0, toplam = ara toplam + teslimat;
 *      teslimat ucretinin iki kolu (esik alti ucretli, esik ustu ucretsiz; on kosul fixture'dan).
 *
 * Sozlesme siniri (BatchGetOffers 100/101, olmayan market) catalog PR 2'de (CQ7).
 */

import { AppError, CURRENCY, ERROR_CODES, silentLogger } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import type { CatalogSnapshot } from '../../../catalog-service/src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../../catalog-service/src/infrastructure/fixtures.js';
import { useCatalogWorld } from '../../../catalog-service/test/support/qa-catalog-world.js';
import type { CatalogOffer } from '../../src/domain/price-draft.js';
import { priceDraft } from '../../src/domain/price-draft.js';
import { GrpcCatalogPricing } from '../../src/infrastructure/catalog/grpc-catalog-pricing.js';

const world = useCatalogWorld('qa_order_katalog_fiyat');
const MARKET = 'mkt_migros-jet-moda';
/** Fixture'in kapali marketi (isOpen false). */
const CLOSED_MARKET = 'mkt_carrefour-express-kadikoy';
const PASSIVE_PRODUCT = 'prd_sut-1l';
const MISSING_PRODUCT = 'prd_qa-olmayan-urun';
const CALL_TIMEOUT_MS = 5_000;
const scope = { requestId: 'req_qa_katalog_fiyat', logger: silentLogger };

const marketOffers = CATALOG_SNAPSHOT.offers.filter((offer) => offer.marketId === MARKET);
const otherMarketOffer = CATALOG_SNAPSHOT.offers.find(
  (offer) =>
    offer.marketId !== MARKET &&
    offer.isActive &&
    !marketOffers.some((own) => own.productId === offer.productId),
);
const activeHere = marketOffers.filter(
  (offer) => offer.isActive && offer.productId !== PASSIVE_PRODUCT,
);

/** Fixture katalog, bu marketin bir teklifi pasife cekilmis. */
const SNAPSHOT: CatalogSnapshot = {
  ...CATALOG_SNAPSHOT,
  offers: CATALOG_SNAPSHOT.offers.map((offer) =>
    offer.marketId === MARKET && offer.productId === PASSIVE_PRODUCT
      ? { ...offer, isActive: false }
      : offer,
  ),
};

/** Seed'in o urun icin beklenen teklifi (urun bilgisi seed urununden, fiyat teklif tohumundan). */
function seedOffer(productId: string, priceMinor: number): CatalogOffer {
  const product = CATALOG_SNAPSHOT.products.find((candidate) => candidate.id === productId);
  if (product === undefined) throw new Error(`fixture urunu yok: ${productId}`);
  return {
    productId,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    unitPriceMinor: priceMinor,
    currency: CURRENCY,
  };
}

const byProduct = <T extends { readonly productId: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => left.productId.localeCompare(right.productId));

async function withPricing<T>(
  server: TestGrpcServer | undefined,
  use: (pricing: GrpcCatalogPricing) => Promise<T>,
): Promise<T> {
  if (server === undefined) throw new Error('catalog sunucusu yok');
  const pricing = new GrpcCatalogPricing(
    `127.0.0.1:${String(server.handle.port)}`,
    CALL_TIMEOUT_MS,
  );
  try {
    return await use(pricing);
  } finally {
    pricing.close();
  }
}

describe('QA CQ3 siparisin fiyat kaynagi (order istemcisi + gercek catalog)', () => {
  it('P1-P3 aktif teklifler, kurallar ve fiyatlama seed ile birebir; pasif urun sepeti acmaz; kapali market yalniz isOpen', async () => {
    const [first, second] = activeHere;
    if (first === undefined || second === undefined || otherMarketOffer === undefined) {
      throw new Error('fixture teklifleri yetersiz');
    }
    const market = CATALOG_SNAPSHOT.markets.find((candidate) => candidate.id === MARKET);
    const closed = CATALOG_SNAPSHOT.markets.find((candidate) => candidate.id === CLOSED_MARKET);
    if (market === undefined || closed?.isOpen !== false) {
      throw new Error('fixture marketleri beklenen gibi degil');
    }
    const [server] = await world.open(SNAPSHOT);
    if (server === undefined) throw new Error('catalog sunucusu yok');
    const requested = [
      first.productId,
      PASSIVE_PRODUCT,
      second.productId,
      first.productId,
      otherMarketOffer.productId,
      MISSING_PRODUCT,
    ];

    // Ham sozlesme: pasif urun de "bu marketin satmadigi" sayilir.
    const raw = await server.call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: MARKET,
      productIds: requested,
    });
    expect({
      offers: raw.response?.offers.map(({ productId }) => productId).sort(),
      missing: [...(raw.response?.missing ?? [])].sort(),
    }).toEqual({
      offers: [first.productId, second.productId].sort(),
      missing: [PASSIVE_PRODUCT, otherMarketOffer.productId, MISSING_PRODUCT].sort(),
    });

    await withPricing(server, async (pricing) => {
      const offers = await pricing.activeOffers(MARKET, requested, scope);
      expect(byProduct(offers)).toEqual(
        byProduct([
          seedOffer(first.productId, first.priceMinor),
          seedOffer(second.productId, second.priceMinor),
        ]),
      );

      const terms = await pricing.marketRules(MARKET, scope);
      expect(terms).toEqual({
        isOpen: true,
        rules: market.pricingRules,
        location: { lat: market.lat, lng: market.lng },
        deliveryRadiusMeters: market.deliveryRadiusMeters,
      });
      expect(await pricing.marketRules(CLOSED_MARKET, scope)).toEqual({ isOpen: false });
      if (!terms.isOpen) throw new Error('acik market kapali dondu');
      const { rules } = terms;

      // Pasif urunlu sepet: yalniz o urun "satista degil".
      const quantity = Math.ceil(rules.minBasketMinor / first.priceMinor) + 1;
      const withPassive = (() => {
        try {
          priceDraft({
            lines: [
              { productId: first.productId, quantity },
              { productId: PASSIVE_PRODUCT, quantity: 1 },
            ],
            offers,
            rules,
            isFirstOrder: false,
          });
          return undefined;
        } catch (error: unknown) {
          return error;
        }
      })();
      expect(withPassive).toBeInstanceOf(AppError);
      const { code, details } = withPassive as AppError;
      expect({ code, details }).toEqual({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { unavailableProductIds: [PASSIVE_PRODUCT] },
      });

      // Teslimat ucretinin iki kolu: esigin altinda ucretli, esikte ve ustunde ucretsiz.
      const paidQuantity = Math.ceil(rules.minBasketMinor / first.priceMinor);
      const paidSubtotal = paidQuantity * first.priceMinor;
      const freeSubtotal = quantity * first.priceMinor + second.priceMinor;
      expect([
        paidSubtotal < rules.freeDeliveryThresholdMinor,
        freeSubtotal >= rules.freeDeliveryThresholdMinor,
        rules.deliveryFeeMinor > 0,
      ]).toEqual([true, true, true]);
      const totalsOf = (lines: readonly { productId: string; quantity: number }[]) => {
        const { pricing: totals } = priceDraft({ lines, offers, rules, isFirstOrder: false });
        return {
          subtotal: totals.subtotalMinor,
          deliveryFee: totals.deliveryFeeMinor,
          discount: totals.discountMinor,
          total: totals.totalMinor,
        };
      };
      expect(totalsOf([{ productId: first.productId, quantity: paidQuantity }])).toEqual({
        subtotal: paidSubtotal,
        deliveryFee: rules.deliveryFeeMinor,
        discount: 0,
        total: paidSubtotal + rules.deliveryFeeMinor,
      });
      expect(
        totalsOf([
          { productId: first.productId, quantity },
          { productId: second.productId, quantity: 1 },
        ]),
      ).toEqual({ subtotal: freeSubtotal, deliveryFee: 0, discount: 0, total: freeSubtotal });
    });
  });
});
