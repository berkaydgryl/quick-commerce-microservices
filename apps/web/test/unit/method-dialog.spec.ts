/**
 * "Ödeme Yöntemi Seç" penceresinin kurallari (T17.1; F5, P1-P4): odemede
 * kullanilacak kart (secilen gecerliyse o, yoksa en yeni gecerli kart),
 * adim gecisleri (liste, ekleme, silme onayi), geri donuste odak, eklenen
 * kartin secili gelmesi, silinen secili kartta yeni secim; kart formunda
 * ikinci gonderme birakilir (ek sart 3).
 */

import type { SavedCard } from '@getir/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createSingleFlight } from '../../src/features/cards/services/single-flight';
import {
  methodDialogReducer,
  openMethodDialog,
} from '../../src/features/checkout/services/method-dialog';
import type { MethodDialogState } from '../../src/features/checkout/services/method-dialog';
import { effectiveCard } from '../../src/features/checkout/services/selected-card';

import { EXPIRED_AMEX, VISA_CARD } from './card-test-support';

const OLD_MASTERCARD: SavedCard = {
  ...VISA_CARD,
  id: 'crd_00000000000000000000000000000003',
  brand: 'MASTERCARD',
  first4: '5555',
  last4: '4444',
  nickname: undefined,
  createdAt: '2026-09-20T12:00:00.000Z',
};
const NEW_TROY: SavedCard = {
  ...VISA_CARD,
  id: 'crd_00000000000000000000000000000004',
  brand: 'TROY',
  first4: '9792',
  last4: '0001',
  createdAt: '2026-10-06T12:00:00.000Z',
};
const CARDS = [VISA_CARD, EXPIRED_AMEX, OLD_MASTERCARD];

const run = (state: MethodDialogState, ...actions: Parameters<typeof methodDialogReducer>[1][]) =>
  actions.reduce(methodDialogReducer, state);

describe('effectiveCard (P2)', () => {
  it('secilen kart listede ve gecerliyse o', () => {
    expect(effectiveCard(CARDS, OLD_MASTERCARD.id)).toBe(OLD_MASTERCARD);
  });

  it('secim yoksa suresi gecmemis en yeni kart (M4)', () => {
    expect(effectiveCard(CARDS, undefined)).toBe(VISA_CARD);
  });

  it('secilen kartin suresi gectiyse en yeni gecerli karta doner', () => {
    expect(effectiveCard(CARDS, EXPIRED_AMEX.id)).toBe(VISA_CARD);
  });

  it('secilen kart silindiyse (listede yok) kalan en yeni gecerli kart', () => {
    expect(effectiveCard([EXPIRED_AMEX, OLD_MASTERCARD], VISA_CARD.id)).toBe(OLD_MASTERCARD);
  });

  it('gecerli kart kalmadiysa undefined (Sipariş Ver pasif)', () => {
    expect(effectiveCard([EXPIRED_AMEX], undefined)).toBeUndefined();
    expect(effectiveCard([], VISA_CARD.id)).toBeUndefined();
  });
});

describe('pencerenin adimlari (P1, P3, P4)', () => {
  it('"Değiştir": liste, uygulanan kart secili, odak secili radyoda', () => {
    expect(openMethodDialog(OLD_MASTERCARD.id, 'list')).toEqual({
      step: { kind: 'list' },
      pendingId: OLD_MASTERCARD.id,
      focus: { kind: 'selected' },
      addSession: 0,
    });
  });

  it('"Kart ekle" (kart yokken): dogrudan ekleme adimi; geri listeye, odak "+ Kredi/Banka Kartı"', () => {
    const opened = openMethodDialog(undefined, 'add');

    expect(opened.step).toEqual({ kind: 'add' });
    expect(run(opened, { type: 'back' })).toMatchObject({
      step: { kind: 'list' },
      focus: { kind: 'add' },
    });
  });

  it('secim yalnizca bekler; "Seç" gelene kadar sayfaya yazilmaz (pencerede kalir)', () => {
    const state = run(openMethodDialog(VISA_CARD.id, 'list'), {
      type: 'pick',
      cardId: OLD_MASTERCARD.id,
    });

    expect(state.pendingId).toBe(OLD_MASTERCARD.id);
    expect(state.step).toEqual({ kind: 'list' });
  });

  it('ekleme: geri -> liste, odak "+ Kredi/Banka Kartı"', () => {
    const state = run(
      openMethodDialog(VISA_CARD.id, 'list'),
      { type: 'openAdd' },
      { type: 'back' },
    );

    expect(state).toMatchObject({ step: { kind: 'list' }, focus: { kind: 'add' } });
  });

  it('P3: kart eklenince listeye donulur, yeni kart SECILI, odak onun radyosunda', () => {
    const adding = run(openMethodDialog(VISA_CARD.id, 'list'), { type: 'openAdd' });
    const state = run(adding, { type: 'added', card: NEW_TROY, session: adding.addSession });

    expect(state).toMatchObject({
      step: { kind: 'list' },
      pendingId: NEW_TROY.id,
      focus: { kind: 'selected' },
    });
    expect(effectiveCard([NEW_TROY, ...CARDS], state.pendingId)).toBe(NEW_TROY);
  });

  it('eski ekleme adiminin gec gelen sonucu yeni adimi kapatmaz', () => {
    const first = run(openMethodDialog(VISA_CARD.id, 'list'), { type: 'openAdd' });
    const again = run(first, { type: 'back' }, { type: 'openAdd' });

    expect(run(again, { type: 'added', card: NEW_TROY, session: first.addSession })).toBe(again);
    const listed = run(first, { type: 'back' });
    expect(run(listed, { type: 'added', card: NEW_TROY, session: first.addSession })).toBe(listed);
  });

  it('silme onayi: Vazgeç/geri -> liste, odak o kartin "Kartı Sil"inde', () => {
    const state = run(
      openMethodDialog(VISA_CARD.id, 'list'),
      { type: 'openDelete', card: VISA_CARD },
      { type: 'back' },
    );

    expect(state).toMatchObject({
      step: { kind: 'list' },
      focus: { kind: 'delete', cardId: VISA_CARD.id },
    });
  });

  it('P2: secili kart silinince secim birakilir: kalan en yeni gecerli kart secili', () => {
    const state = run(
      openMethodDialog(VISA_CARD.id, 'list'),
      { type: 'openDelete', card: VISA_CARD },
      { type: 'deleted', cardId: VISA_CARD.id },
    );

    expect(state).toMatchObject({
      step: { kind: 'list' },
      pendingId: undefined,
      focus: { kind: 'selected' },
    });
    expect(effectiveCard([EXPIRED_AMEX, OLD_MASTERCARD], state.pendingId)).toBe(OLD_MASTERCARD);
  });

  it('baska kart (suresi gecmis) silinince secim korunur', () => {
    const state = run(
      openMethodDialog(OLD_MASTERCARD.id, 'list'),
      { type: 'openDelete', card: EXPIRED_AMEX },
      { type: 'deleted', cardId: EXPIRED_AMEX.id },
    );

    expect(state.pendingId).toBe(OLD_MASTERCARD.id);
  });

  it('listede geri yok: durum degismez (Esc pencereyi kapatir)', () => {
    const state = openMethodDialog(VISA_CARD.id, 'list');

    expect(run(state, { type: 'back' })).toBe(state);
  });
});

describe('createSingleFlight (ek sart 3: cift basis, cift istek yok)', () => {
  it('is surerken ikinci cagri birakilir; bitince yeniden calisir', async () => {
    const once = createSingleFlight();
    let finish: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const first = once(task);
    await once(task);
    expect(task).toHaveBeenCalledTimes(1);

    finish();
    await first;
    void once(task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('is hata verse de kilit acilir', async () => {
    const once = createSingleFlight();
    const failing = vi.fn(() => Promise.reject(new Error('402')));

    await expect(once(failing)).rejects.toThrow('402');
    await expect(once(failing)).rejects.toThrow('402');
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
