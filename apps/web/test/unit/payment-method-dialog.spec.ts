/**
 * "Ödeme Yöntemi Seç" penceresinin gorunumu (T17.1; F5; plan metni, #34-#37
 * diskte yok): "Online Ödeme" radyo grubu (fieldset ve legend), suresi gecmis
 * kart secilemez ama silinebilir, secili kartin yaninda "Kartı Sil", "+
 * Kredi/Banka Kartı" Ödeme Yöntemlerim'e GITMEZ (ayni pencerede ekleme adimi:
 * AddCardForm variant="checkout", Guvenlik kutusu yok, kart en ustte), BKM
 * Express ve Masterpass yok. Pencere Ödeme Yöntemlerim'le AYNI kart sorgusunu
 * okur; ekleme ve silme o anahtari gunceller (ek sart 2).
 */

import { CONTENT_FALLBACK, SAVED_CARDS_MAX } from '@getir/contracts';
import type { SavedCard, SavedCardList } from '@getir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { cardKeys } from '../../src/features/cards/api/query-keys';
import { saveCard } from '../../src/features/cards/hooks/useAddCard';
import { applyDeletedList } from '../../src/features/cards/hooks/useDeleteCard';
import { useSavedCards } from '../../src/features/cards/hooks/useSavedCards';
import { createAttemptKeys } from '../../src/features/cards/services/attempt-key';
import { AddCardForm } from '../../src/features/cards/ui/AddCardForm';
import { PaymentMethodDialog } from '../../src/features/checkout/ui/PaymentMethodDialog';
import { PaymentMethodList } from '../../src/features/checkout/ui/PaymentMethodList';
import { createHttpClient } from '../../src/shared/api/http-client';

import { EXPIRED_AMEX, VISA_CARD, VISA_NUMBER } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.checkout;
const CARD_TEXTS = CONTENT_FALLBACK.paymentMethods;
const USER = 'usr_00000000000000000000000000000001';
const noop = () => undefined;
const MASTERCARD: SavedCard = {
  ...VISA_CARD,
  id: 'crd_00000000000000000000000000000003',
  brand: 'MASTERCARD',
  first4: '5555',
  last4: '4444',
  nickname: 'İş',
  createdAt: '2026-09-20T12:00:00.000Z',
};
const CARDS = [VISA_CARD, EXPIRED_AMEX, MASTERCARD];

const list = (cards: readonly SavedCard[], selectedId: string | undefined) =>
  renderToStaticMarkup(
    createElement(PaymentMethodList, {
      cards,
      selectedId,
      focus: { kind: 'selected' },
      texts: TEXTS,
      cardTexts: CARD_TEXTS,
      onPick: noop,
      onDelete: noop,
      onAdd: noop,
      onChoose: noop,
    }),
  );

function dialog(start: 'list' | 'add', client = new QueryClient()) {
  client.setQueryData<SavedCardList>(cardKeys.list(USER), { items: CARDS });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PaymentMethodDialog, {
        userId: USER,
        appliedId: VISA_CARD.id,
        start,
        texts: TEXTS,
        cardTexts: CARD_TEXTS,
        onChoose: noop,
        onClose: noop,
      }),
    ),
  );
}

/** Satirlar: kart basina bir <li>, sonda ekleme satiri. */
const rows = (html: string) => html.split('<li').slice(1);
const escape = (text: string) => text.replace(/'/g, '&#x27;');

describe('PaymentMethodList (F5)', () => {
  it('radyo grubu: fieldset ve legend "Online Ödeme"; tum radyolar ayni adla (ok tuslari)', () => {
    const html = list(CARDS, VISA_CARD.id);
    const names = [...html.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map((match) => match[1]);

    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Online Ödeme<\/legend>/);
    expect(names).toHaveLength(CARDS.length);
    expect(new Set(names).size).toBe(1);
  });

  it('satir: logo, kart adi, maskeli numara; radyonun adi okunan kart adi', () => {
    const [visa] = rows(list(CARDS, VISA_CARD.id));

    expect(visa).toContain('>Maaş kartım<');
    expect(visa).toContain('4242 **** **** 4242');
    expect(visa).toMatch(
      /<label[^>]*><input type="radio"[\s\S]*Maaş kartım, Visa, son dört hane 4242/,
    );
  });

  it('secili kart isaretli; "Kartı Sil" yalnizca secili kartta ve suresi gecmis kartta', () => {
    const [visa, amex, master] = rows(list(CARDS, VISA_CARD.id));

    expect(visa).toMatch(/type="radio"[^>]*checked=""/);
    expect(visa).toContain('>Kartı Sil<');
    expect(amex).toContain('>Kartı Sil<');
    expect(master).not.toContain('Kartı Sil');
    expect(master).not.toContain('checked');
  });

  it('suresi gecmis kart: radyo pasif, "Süresi doldu"; silme dugmesinin okunan adi karti soyler', () => {
    const [, amex] = rows(list(CARDS, VISA_CARD.id));

    expect(amex).toMatch(/type="radio"[^>]*disabled=""/);
    expect(amex).toContain(CARD_TEXTS.expiredLabel);
    expect(amex).toMatch(/Kartı Sil<span[^>]*>, Amex, son dört hane 0005<\/span><\/button>/);
  });

  it('"+ Kredi/Banka Kartı" bir DUGME: Ödeme Yöntemlerim\'e baglanti yok', () => {
    const html = list(CARDS, VISA_CARD.id);

    expect(html).toMatch(
      /<button type="button"[^>]*data-method-add=""[\s\S]*Kredi\/Banka Kartı<\/button>/,
    );
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
    expect(html).not.toContain('odeme-yontemlerim');
  });

  it('BKM Express ve Masterpass yok', () => {
    expect(list(CARDS, VISA_CARD.id)).not.toMatch(/bkm|masterpass/i);
  });

  it('"Seç": secim varken etkin; gecerli kart yoksa pasif', () => {
    expect(list(CARDS, VISA_CARD.id)).toMatch(
      /<button type="button" class="[^"]*__choose[^"]*">Seç<\/button>/,
    );
    expect(list([EXPIRED_AMEX], undefined)).toMatch(/<button[^>]*disabled=""[^>]*>Seç<\/button>/);
  });

  it('kasa dolu: "+ Kredi/Banka Kartı" yerine sozlesmenin cumlesi', () => {
    const full = Array.from({ length: SAVED_CARDS_MAX }, (_, index) => ({
      ...MASTERCARD,
      id: `crd_${String(index).padStart(32, '0')}`,
    }));

    expect(list(full, full[0]?.id)).not.toContain('Kredi/Banka Kartı');
  });

  it('M7: gorunen ve okunan metinde kartin yalnizca ilk 4 ve son 4 hanesi; alan yok', () => {
    const html = list(CARDS, VISA_CARD.id);

    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/\d{5,}/);
    expect(html).not.toMatch(/<input(?![^>]*type="radio")/);
  });
});

describe('PaymentMethodDialog (F5, P1)', () => {
  it('"Değiştir": baslik "Ödeme Yöntemi Seç", sagda X, geri oku YOK; uygulanan kart secili', () => {
    const html = dialog('list');

    expect(html).toContain('>Ödeme Yöntemi Seç</h2>');
    expect(html).toContain('aria-label="Kapat"');
    expect(html).not.toContain('aria-label="Geri"');
    expect(rows(html)[0]).toMatch(/type="radio"[^>]*checked=""/);
  });

  it('ekleme adimi: baslik "Kart Ekle", geri oku; form variant="checkout"; Ödeme Yöntemlerim\'e gidilmez', () => {
    const html = dialog('add');

    expect(html).toContain(`>${CARD_TEXTS.addTitle}</h2>`);
    expect(html).toContain('aria-label="Geri"');
    expect(html).toContain('aria-label="Kapat"');
    expect(html).toContain('c-add-card--checkout');
    expect(html).not.toContain('odeme-yontemlerim');
    expect(html).not.toContain(escape(CARD_TEXTS.backToListLabel));
  });

  it("ek sart 2: pencere Ödeme Yöntemlerim'le AYNI sorguyu okur (cardKeys.list)", () => {
    const fromDialog = new QueryClient();
    dialog('list', fromDialog);
    const fromPage = new QueryClient();
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: fromPage },
        createElement(function PaymentMethodsProbe() {
          useSavedCards(USER);
          return null;
        }),
      ),
    );
    const keys = (client: QueryClient) =>
      client
        .getQueryCache()
        .findAll()
        .map((query) => query.queryKey);

    expect(keys(fromDialog)).toEqual([['cards', 'list', USER]]);
    expect(keys(fromDialog)).toEqual(keys(fromPage));
  });

  it('ek sart 2: ekleme listeyi o anahtarda gunceller ve gecersizler; silme guncel listeyi oraya yazar', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: VISA_CARD }))),
    );
    const client = createHttpClient({ baseUrl: 'http://gateway.test', fetch: fetchMock });
    queryClient.setQueryData<SavedCardList>(cardKeys.list(USER), { items: [MASTERCARD] });

    await saveCard({
      client,
      queryClient,
      userId: USER,
      attempts: createAttemptKeys(),
      request: {
        number: VISA_NUMBER,
        expiryMonth: 8,
        expiryYear: 2029,
        cvv: '987',
        holderName: 'Ayşe Yılmaz',
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cards', 'list', USER] });

    await applyDeletedList(queryClient, USER, { items: [MASTERCARD] });
    expect(queryClient.getQueryData(['cards', 'list', USER])).toEqual({ items: [MASTERCARD] });
    await applyDeletedList(queryClient, USER, null);
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['cards', 'list', USER] });
  });
});

describe('AddCardForm variant (F5)', () => {
  const form = (variant: 'page' | 'checkout') =>
    renderToStaticMarkup(
      createElement(AddCardForm, {
        texts: CARD_TEXTS,
        variant,
        onSave: () => Promise.resolve(VISA_CARD),
        onChanged: noop,
        onSaved: noop,
      }),
    );

  it('checkout: Guvenlik kutusu YOK; kart gorseli ilk alandan once (en ustte)', () => {
    const html = form('checkout');

    expect(html).not.toContain(`>${CARD_TEXTS.securityTitle}<`);
    expect(html.indexOf('c-payment-card__tilt')).toBeGreaterThan(-1);
    expect(html.indexOf('c-payment-card__tilt')).toBeLessThan(html.indexOf('id="kart-takma-ad"'));
    expect(html).toMatch(/<form class="[^"]*c-add-card_[^"]* [^"]*c-add-card--checkout/);
  });

  it('page (varsayilan): Guvenlik kutusu ve sinif degismedi; checkout sinifi yok', () => {
    const html = form('page');

    expect(html).toContain(`>${CARD_TEXTS.securityTitle}<`);
    expect(html).not.toContain('c-add-card--checkout');
    expect(html).toMatch(/<form class="[^" ]*c-add-card_[^" ]*" novalidate/);
  });
});
