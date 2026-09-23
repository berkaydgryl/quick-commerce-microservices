/**
 * ProductReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar.
 *
 * NEDEN: MOCK modu frontend'in gelistirme ortamidir. Iki uygulama ayni sorguya
 * farkli cevap verirse hata "mock'ta calisiyordu" olarak canli ortamda cikar.
 * Beklentiler demo verisine (fixtures.ts) goredir.
 */

import { describe, expect, it } from 'vitest';

import type { PageQuery, ProductReader } from '../../src/domain/product-reader.js';

const FIRST_PAGE: PageQuery = { size: 20, token: '' };

export function describeProductReaderContract(name: string, getReader: () => ProductReader): void {
  describe(`ProductReader sozlesmesi: ${name}`, () => {
    it('filtresiz: 15 urun, _id sirasinda, pasif urun GIZLENMEZ', async () => {
      const page = await getReader().listProducts({}, FIRST_PAGE);

      expect(page.totalSize).toBe(15);
      expect(page.items.map((item) => item.id)).toEqual(
        Array.from({ length: 15 }, (_, index) => `prd_${String(index + 1).padStart(2, '0')}`),
      );
      expect(page.items.find((item) => item.id === 'prd_15')?.isActive).toBe(false);
      expect(page.nextPageToken).toBe('');
    });

    it('imlecle sayfalar: tekrar ve kayip yok', async () => {
      const repository = getReader();
      const seen: string[] = [];
      let token = '';
      let pages = 0;

      do {
        const page = await repository.listProducts({}, { size: 4, token });
        // Toplam sayi imlecten bagimsiz: filtreye uyan TUM kayitlar.
        expect(page.totalSize).toBe(15);
        seen.push(...page.items.map((item) => item.id));
        token = page.nextPageToken;
        pages += 1;
      } while (token !== '' && pages < 10);

      expect(pages).toBe(4);
      expect(seen).toHaveLength(15);
      expect(new Set(seen).size).toBe(15);
    });

    it('son sayfanin tam sinirinda nextPageToken bostur', async () => {
      // 15 kayit, 5'lik sayfa: ucuncu sayfa tam doluyor ve devami yok. "Bir
      // fazla iste" kurali burada yanlissa bos bir dorduncu sayfa istenir.
      const page = await getReader().listProducts({}, { size: 5, token: 'prd_10' });

      expect(page.items.map((item) => item.id)).toEqual([
        'prd_11',
        'prd_12',
        'prd_13',
        'prd_14',
        'prd_15',
      ]);
      expect(page.nextPageToken).toBe('');
    });

    it('imlec son kaydin otesindeyse bos sayfa', async () => {
      const page = await getReader().listProducts({}, { size: 5, token: 'prd_99' });

      expect(page.items).toEqual([]);
      expect(page.nextPageToken).toBe('');
    });

    it('kategori filtresi', async () => {
      const page = await getReader().listProducts({ categoryId: 'cat_2' }, FIRST_PAGE);

      expect(page.items.map((item) => item.sku)).toEqual([
        'DOMATES-1K',
        'MUZ-1K',
        'ELMA-1K',
        'SALATALIK-1K',
      ]);
      expect(page.totalSize).toBe(4);
    });

    it('depo filtresi o depoda satilmayani eler', async () => {
      const page = await getReader().listProducts({ darkStoreId: 'ds_besiktas' }, FIRST_PAGE);

      expect(page.items.map((item) => item.id)).toEqual(['prd_01', 'prd_05', 'prd_09', 'prd_12']);
    });

    it('filtreler birlikte uygulanir; eslesme yoksa bos liste', async () => {
      const page = await getReader().listProducts(
        { darkStoreId: 'ds_besiktas', categoryId: 'cat_5' },
        FIRST_PAGE,
      );

      expect(page.items).toEqual([]);
      expect(page.totalSize).toBe(0);
    });

    it('arama ad ve aciklamada, Turkce buyuk harfle de calisir', async () => {
      // "ÇİKOLATA".toLowerCase() Turkce kurallarla "çikolata" olur. Mongo'nun
      // regex "i" bayragi "İ" -> "i" eslemesini bilmez; searchTerms bu yuzden var.
      const page = await getReader().listProducts({ query: 'ÇİKOLATA' }, FIRST_PAGE);

      expect(page.items.map((item) => item.sku)).toEqual(['CIKOLATA-80']);
    });

    it('arama aciklamayi da tarar', async () => {
      // "Sütlü çikolata" aciklamasi da "süt" icerir.
      const page = await getReader().listProducts({ query: 'süt' }, FIRST_PAGE);

      expect(page.items.map((item) => item.sku)).toEqual(['SUT-1L', 'CIKOLATA-80']);
    });

    it('arama metni desen degil duz metindir', async () => {
      const repository = getReader();

      // "%100" aciklamada gecer; "." ve "*" regex ozel karakteri olarak
      // yorumlansaydi her seyi eslerdi.
      expect(
        (await repository.listProducts({ query: '%100' }, FIRST_PAGE)).items.map(
          (item) => item.sku,
        ),
      ).toEqual(['PORTAKAL-SUYU-1L']);
      expect((await repository.listProducts({ query: '.*' }, FIRST_PAGE)).items).toEqual([]);
    });
  });
}
