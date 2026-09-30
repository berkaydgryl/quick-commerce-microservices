/**
 * OfferReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. Beklentiler demo verisine (fixtures) goredir.
 */

import { describe, expect, it } from 'vitest';

import type { MarketOfferMatches, OfferReader, PageQuery } from '../../src/domain/offer-reader.js';

const FIRST_PAGE: PageQuery = { size: 50, token: '' };
const MIGROS_MODA = 'mkt_migros-jet-moda';
const A101 = 'mkt_a101-caferaga';
const MANAV = 'mkt_kardesler-manavi';

export function describeOfferReaderContract(name: string, getReader: () => OfferReader): void {
  describe(`OfferReader sozlesmesi: ${name}`, () => {
    it('yalnizca o marketin teklifleri, _id sirasinda', async () => {
      const page = await getReader().listOffers({ marketId: MANAV }, FIRST_PAGE);

      expect(page.items.map((offer) => offer.product.sku)).toEqual([
        'DOMATES-1K',
        'ELMA-1K',
        'MUZ-1K',
        'SALATALIK-1K',
      ]);
      expect(page.items.every((offer) => offer.marketId === MANAV)).toBe(true);
      expect(page.totalSize).toBe(4);
    });

    it('AYNI urun iki markette FARKLI fiyatla (ADR-15)', async () => {
      const reader = getReader();
      const priceIn = async (marketId: string): Promise<number | undefined> =>
        (await reader.listOffers({ marketId, query: 'süt 1' }, FIRST_PAGE)).items.find(
          (offer) => offer.product.id === 'prd_sut-1l',
        )?.priceMinor;

      expect(await priceIn(MIGROS_MODA)).toBe(3490);
      expect(await priceIn(A101)).toBe(3210);
    });

    it('marketin satmadigi urun listede yok', async () => {
      const page = await getReader().listOffers({ marketId: A101, query: 'tereyağı' }, FIRST_PAGE);

      expect(page.items).toEqual([]);
    });

    it('satistan kaldirilmis teklif GIZLENMEZ (istemci "satista degil" gosterir)', async () => {
      const page = await getReader().listOffers({ marketId: MIGROS_MODA }, FIRST_PAGE);

      expect(page.items.find((offer) => offer.product.sku === 'CAMASIR-SUYU')?.isActive).toBe(
        false,
      );
      expect(page.totalSize).toBe(15);
    });

    it('kategori filtresi', async () => {
      const page = await getReader().listOffers(
        { marketId: MIGROS_MODA, categoryId: 'cat_icecek' },
        FIRST_PAGE,
      );

      expect(page.items.map((offer) => offer.product.sku)).toEqual([
        'KOLA-1L',
        'PORTAKAL-SUYU-1L',
        'SU-5L',
      ]);
    });

    it('imlecle sayfalar: tekrar ve kayip yok, toplam imlecten bagimsiz', async () => {
      const reader = getReader();
      const seen: string[] = [];
      let token = '';
      let pages = 0;
      do {
        const page = await reader.listOffers({ marketId: MIGROS_MODA }, { size: 4, token });
        expect(page.totalSize).toBe(15);
        seen.push(...page.items.map((offer) => offer.id));
        token = page.nextPageToken;
        pages += 1;
      } while (token !== '' && pages < 10);

      expect(pages).toBe(4);
      expect(new Set(seen).size).toBe(15);
    });

    it('son sayfanin tam sinirinda nextPageToken bostur', async () => {
      // Manav 4 teklif, 2'lik sayfa: ikinci sayfa tam doluyor, devami yok.
      const reader = getReader();
      const first = await reader.listOffers({ marketId: MANAV }, { size: 2, token: '' });
      const second = await reader.listOffers(
        { marketId: MANAV },
        { size: 2, token: first.nextPageToken },
      );

      expect(second.items).toHaveLength(2);
      expect(second.nextPageToken).toBe('');
    });

    it('arama Turkce buyuk harfle calisir ve aciklamayi da tarar', async () => {
      const reader = getReader();

      expect(
        (
          await reader.listOffers({ marketId: MIGROS_MODA, query: 'ÇİKOLATA' }, FIRST_PAGE)
        ).items.map((offer) => offer.product.sku),
      ).toEqual(['CIKOLATA-80']);
      // "Sütlü çikolata" aciklamasi da "süt" icerir.
      expect(
        (await reader.listOffers({ marketId: MIGROS_MODA, query: 'süt' }, FIRST_PAGE)).items
          .map((offer) => offer.product.sku)
          .sort(),
      ).toEqual(['CIKOLATA-80', 'SUT-1L']);
    });

    it('arama Turkce karakter duyarsiz ve cok kelimede her kelimeyi ister (T9.4)', async () => {
      const reader = getReader();
      const skus = async (query: string): Promise<string[]> =>
        (await reader.listOffers({ marketId: MIGROS_MODA, query }, FIRST_PAGE)).items
          .map((offer) => offer.product.sku)
          .sort();

      // Turkce karaktersiz yazim: "sut" hem "Süt 1 L"yi hem "Sütlü çikolata"yi bulur.
      expect(await skus('sut')).toEqual(['CIKOLATA-80', 'SUT-1L']);
      expect(await skus('cengelkoy')).toEqual(['SALATALIK-1K']);
      // Her kelime gecmeli, sira onemsiz; kelimeler ad ve aciklamaya dagilabilir.
      expect(await skus('peynir beyaz')).toEqual(['PEYNIR-500']);
      expect(await skus('TAM YAGLI')).toEqual(['PEYNIR-500', 'SUT-1L']);
      expect(await skus('süt 1')).toEqual(['SUT-1L']);
      expect(await skus('süt elma')).toEqual([]);
      // Kelime icinde eslesme: "kola" "Çikolata"nin da icinde gecer (T9.4 oncesi de boyleydi).
      expect(await skus('kola')).toEqual(['CIKOLATA-80', 'KOLA-1L']);
    });

    it('arama metni desen degil duz metindir', async () => {
      const reader = getReader();

      expect(
        (await reader.listOffers({ marketId: MIGROS_MODA, query: '%100' }, FIRST_PAGE)).items.map(
          (offer) => offer.product.sku,
        ),
      ).toEqual(['PORTAKAL-SUYU-1L']);
      expect(
        (await reader.listOffers({ marketId: MIGROS_MODA, query: '.*' }, FIRST_PAGE)).items,
      ).toEqual([]);
    });

    it('marketin aktif teklifi olan kategoriler: manav yalnizca meyve-sebze', async () => {
      const reader = getReader();

      expect(await reader.listCategoryIdsWithOffers(MANAV)).toEqual(['cat_meyve-sebze']);
      expect([...(await reader.listCategoryIdsWithOffers(MIGROS_MODA))].sort()).toEqual([
        'cat_atistirmalik',
        'cat_icecek',
        'cat_meyve-sebze',
        'cat_sut-kahvaltilik',
        'cat_temizlik',
      ]);
      expect(await reader.listCategoryIdsWithOffers('mkt_yok')).toEqual([]);
    });
  });

  describe(`OfferReader.searchActiveOffers sozlesmesi (T9.6): ${name}`, () => {
    /** Gruplarin sirasi sozlesmede YOK (siralama use-case'te): market kimligine gore dizilir. */
    const summary = (groups: readonly MarketOfferMatches[]) =>
      [...groups]
        .sort((left, right) => (left.marketId < right.marketId ? -1 : 1))
        .map((group) => ({
          marketId: group.marketId,
          skus: group.offers.map((offer) => offer.product.sku),
          total: group.totalMatches,
        }));

    it('market basina ilk N teklif market sayfasi sirasinda (_id); toplam ayrica sayilir', async () => {
      // "su": Su 5 L, Süt 1 L, Sütlü çikolata, Portakal Suyu, Çamaşır Suyu. Manav hicbirini satmaz.
      const groups = await getReader().searchActiveOffers([A101, MANAV, MIGROS_MODA], 'su', 3);

      expect(summary(groups)).toEqual([
        { marketId: A101, skus: ['CAMASIR-SUYU', 'CIKOLATA-80', 'SU-5L'], total: 4 },
        { marketId: MIGROS_MODA, skus: ['CIKOLATA-80', 'PORTAKAL-SUYU-1L', 'SU-5L'], total: 4 },
      ]);
    });

    it('PASIF teklif sayilmaz: Migros Moda camasir suyunu satistan kaldirmis, A101 satiyor', async () => {
      const groups = await getReader().searchActiveOffers([A101, MIGROS_MODA], 'çamaşır', 3);

      expect(summary(groups)).toEqual([{ marketId: A101, skus: ['CAMASIR-SUYU'], total: 1 }]);
    });

    it('teklif eksiksiz doner: fiyat o marketin (ADR-15)', async () => {
      const [group] = await getReader().searchActiveOffers([MIGROS_MODA], 'süt 1', 3);

      expect(group?.offers).toHaveLength(1);
      expect(group?.offers[0]).toMatchObject({
        marketId: MIGROS_MODA,
        priceMinor: 3490,
        isActive: true,
        product: { sku: 'SUT-1L', name: 'Süt 1 L' },
      });
    });

    it('kelime kurali market ici aramayla ayni: Turkce karakter duyarsiz, her kelime, duz metin', async () => {
      const reader = getReader();
      const skus = async (query: string): Promise<string[]> =>
        (await reader.searchActiveOffers([MIGROS_MODA], query, 20)).flatMap((group) =>
          group.offers.map((offer) => offer.product.sku),
        );

      expect(await skus('TAM YAGLI')).toEqual(['PEYNIR-500', 'SUT-1L']);
      expect(await skus('cengelkoy')).toEqual(['SALATALIK-1K']);
      expect(await skus('süt elma')).toEqual([]);
      expect(await skus('%100')).toEqual(['PORTAKAL-SUYU-1L']);
      expect(await skus('.*')).toEqual([]);
    });

    it('eslesmesi olmayan, bilinmeyen ya da hic verilmeyen market icin grup yok', async () => {
      const reader = getReader();

      expect(await reader.searchActiveOffers([MANAV, 'mkt_yok'], 'süt', 3)).toEqual([]);
      expect(await reader.searchActiveOffers([], 'süt', 3)).toEqual([]);
    });

    it('kelimesiz sorgu (yalnizca bosluk) HICBIR teklifle eslesmez, hepsiyle degil', async () => {
      expect(await getReader().searchActiveOffers([MIGROS_MODA], '   ', 3)).toEqual([]);
    });
  });

  describe(`OfferReader.findOffersByProductIds sozlesmesi: ${name}`, () => {
    const ids = (offers: readonly { product: { id: string } }[]) =>
      offers.map((offer) => offer.product.id).sort();

    it('istenen urunlerin o marketteki tekliflerini doner, fiyatiyla', async () => {
      const offers = await getReader().findOffersByProductIds(MIGROS_MODA, [
        'prd_sut-1l',
        'prd_ekmek-yok',
      ]);

      expect(offers).toHaveLength(1);
      expect(offers[0]).toMatchObject({ marketId: MIGROS_MODA, priceMinor: 3490, isActive: true });
    });

    it('PASIF teklifi de doner: satilir mi karari depo degil use-case isidir', async () => {
      const offers = await getReader().findOffersByProductIds(MIGROS_MODA, ['prd_camasir-suyu']);

      expect(offers.map((offer) => offer.isActive)).toEqual([false]);
    });

    it('baska marketin teklifini DONMEZ (manav sut satmaz)', async () => {
      expect(
        await getReader().findOffersByProductIds(MANAV, ['prd_sut-1l', 'prd_domates-1k']),
      ).toSatisfy(
        (offers: readonly { product: { id: string }; marketId: string }[]) =>
          offers.length === 1 &&
          offers[0]?.product.id === 'prd_domates-1k' &&
          offers[0]?.marketId === MANAV,
      );
    });

    it('bircok urunu tek cagrida doner; bos liste bos doner', async () => {
      const reader = getReader();
      const wanted = ['prd_sut-1l', 'prd_elma-1k', 'prd_kola-1l', 'prd_su-5l'];

      expect(ids(await reader.findOffersByProductIds(A101, wanted))).toEqual([...wanted].sort());
      expect(await reader.findOffersByProductIds(A101, [])).toEqual([]);
    });
  });
}
