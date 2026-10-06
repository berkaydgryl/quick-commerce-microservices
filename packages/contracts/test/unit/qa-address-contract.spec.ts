/**
 * QA kara kutu (T11.15 PR 1, #125; QA incelemesi Q3, Q7, Q8): adres kimliginin
 * sozlesmedeki etkisi, istemci gozunden.
 *
 *   Q7 Eski istemci (kimliksiz sema) yeni cevabi kabul eder, kimligi atar; yeni
 *      istemci kimligi gecerli listeyi kabul eder.
 *   Q3 A1 (b), belgelenen: tek bir satirin kimligi bossa ("id":"", gocten sonra
 *      eski kopyanin ekledigi satir) yeni istemci BUTUN listeyi reddeder; hata
 *      o satirin kimligini gosterir.
 *   Q8 Siparis adresin KOPYASINI tasir: rezervasyon istegindeki adres yalnizca
 *      satir ve konumdur; kayitli adresin kimligi ve adi siparise gecmez, yani
 *      adresi duzenlemek ya da silmek acik siparisi degistiremez.
 */

import { describe, expect, it } from 'vitest';

import {
  reserveCartRequestSchema,
  savedAddressListSchema,
  savedAddressSchema,
} from '../../src/index.js';

const ADDRESS_ID = 'adr_0123456789abcdef0123456789abcdef';
const OTHER_ID = 'adr_fedcba9876543210fedcba9876543210';

const entry = (id: string, title: string) => ({
  id,
  title,
  kind: 'HOME',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
});

/** T11.15 oncesi istemcinin semasi: kimlik alani yok. */
const oldClientListSchema = savedAddressListSchema.extend({
  items: savedAddressListSchema.shape.items.element.omit({ id: true }).array(),
});

describe('QA adres kimligi sozlesmesi (#125)', () => {
  it('Q7 eski istemci yeni cevabi kabul eder ve kimligi atar; yeni istemci kimlikli listeyi kabul eder', () => {
    const response = { items: [entry(ADDRESS_ID, 'Ev'), entry(OTHER_ID, 'İş')] };

    const old = oldClientListSchema.safeParse(response);
    const current = savedAddressListSchema.safeParse(response);

    expect(old.success).toBe(true);
    expect(old.data?.items.map((item) => Object.keys(item).includes('id'))).toEqual([false, false]);
    expect(current.success).toBe(true);
    expect(current.data?.items.map((item) => item.id)).toEqual([ADDRESS_ID, OTHER_ID]);
  });

  it('Q3 A1 (b) belgelenen: tek satirin kimligi bos ("id":"") ise yeni istemci BUTUN listeyi reddeder, hata o satiri gosterir', () => {
    const response = { items: [entry(ADDRESS_ID, 'Ev'), entry('', 'Eski')] };

    const parsed = savedAddressListSchema.safeParse(response);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['items.1.id']);
    // Eski istemci ayni listeyi okur (kimligi okumaz): sorun yalnizca yeni istemcide.
    expect(oldClientListSchema.safeParse(response).success).toBe(true);
    expect(savedAddressSchema.safeParse(entry('', 'Eski')).success).toBe(false);
  });

  it('Q8 siparis adresin kopyasini tasir: rezervasyondaki adres yalnizca satir ve konum, kayitli adresin kimligi ve adi gecmez', () => {
    const saved = { ...entry(ADDRESS_ID, 'Ev'), building: '19C', note: 'Zil bozuk' };

    const parsed = reserveCartRequestSchema.safeParse({
      marketId: 'mkt_migros-jet-moda',
      items: [{ productId: 'prd_sut-1l', quantity: 1 }],
      address: saved,
      expectedTotal: { amountMinor: 1_000, currency: 'TRY' },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.address).toEqual({ line: saved.line, location: saved.location });
  });
});
