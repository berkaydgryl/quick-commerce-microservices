/**
 * AddCard use-case (T11.17): son kullanma, kasa siniri ve ayni kart saglayiciya
 * gitmeden; saglayicinin karari; maskeli kayit. Numara ve CVV kartta, hatada ve
 * gunlukte yok (QA P1, P2, P6).
 */

import { CARD_EXPIRY_MAX_YEARS_AHEAD, SAVED_CARDS_MAX } from '@getir/contracts';
import { ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger, withoutRandomNoise } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createAddCard } from '../../src/application/add-card.js';
import type { AddCardInput } from '../../src/application/add-card.js';
import { CARD_STATUS } from '../../src/domain/card.js';
import type { CardVerifier, VerifyCardInput } from '../../src/domain/card-verifier.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

/** 5 Ekim 2026 12.00 UTC (Istanbul 15.00). */
const NOW_MS = Date.parse('2026-10-05T12:00:00Z');

const REQUEST: AddCardInput = {
  userId: 'usr_kasa',
  number: '4242 4242 4242 4242',
  expiryMonth: 12,
  expiryYear: 2031,
  cvv: '987',
  holderName: 'Ayşe Yılmaz',
  nickname: 'Maaş kartım',
};

/** Mock saglayici + cagri sayaci: "saglayiciya gidilmedi" denetimi icin. */
class CountingVerifier implements CardVerifier {
  calls = 0;
  private readonly mock = new MockPaymentProvider();

  verifyCard(input: VerifyCardInput) {
    this.calls += 1;
    return this.mock.verifyCard(input);
  }
}

function setup(verifier: CardVerifier = new CountingVerifier()) {
  const repository = new InMemoryCardStore();
  const lines: LogLine[] = [];
  const addCard = createAddCard({
    repository,
    verifier,
    clock: fixedClock(NOW_MS),
    maxCards: SAVED_CARDS_MAX,
  });
  const logger = recordingLogger(lines);
  return {
    repository,
    lines,
    add: (overrides: Partial<AddCardInput> = {}) => addCard({ ...REQUEST, ...overrides }, logger),
  };
}

describe('AddCard: onay', () => {
  it('test karti olmayan (kart uretici) Luhn gecerli kart onaylanir: rastgele jeton, kayitta numara yok (bekleyen is 112)', async () => {
    const { add, repository } = setup();

    const card = await add({ number: '4111 1111 1111 1111' });

    expect(card.providerToken).toMatch(/^tok_[0-9a-f]{32}$/);
    expect(card).toMatchObject({ brand: 'VISA', first4: '4111', last4: '1111' });
    const stored = withoutRandomNoise(JSON.stringify(await repository.listActive('usr_kasa')));
    expect(stored).not.toContain('4111111111111111');
    expect(stored).not.toContain('411111');
  });

  it('onaylanan kart maskeli kaydedilir: ilk 4, son 4, marka, saglayici jetonu; numara ve CVV kartta yok (QA P2)', async () => {
    const { add, repository } = setup();

    const card = await add();

    expect(card).toMatchObject({
      userId: 'usr_kasa',
      brand: 'VISA',
      first4: '4242',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: 2031,
      holderName: 'Ayşe Yılmaz',
      nickname: 'Maaş kartım',
      providerToken: 'tok_test_4242',
      status: CARD_STATUS.ACTIVE,
      createdAt: new Date(NOW_MS),
    });
    expect(card.id).toMatch(/^crd_[0-9a-f]{32}$/);
    expect(Object.keys(card)).not.toEqual(expect.arrayContaining(['number']));
    // Kart kimligi rastgele 32 onaltilik: CVV onun icinde tesadufen gecebilir.
    const stored = withoutRandomNoise(JSON.stringify(repository.stored(card.id)));
    expect(stored).not.toContain('4242424242424242');
    expect(stored).not.toContain('987');
  });

  it('her marka: tireli Mastercard, bosluklu Amex, Troy; kart adi yoksa alan yok', async () => {
    const { add } = setup();

    const mastercard = await add({ number: '5555-5555-5555-4444', nickname: undefined });
    const amex = await add({ number: '3782 822463 10005', cvv: '1234' });
    const troy = await add({ number: '9792000000000003' });

    expect(mastercard).toMatchObject({ brand: 'MASTERCARD', first4: '5555', last4: '4444' });
    expect(amex).toMatchObject({ brand: 'AMEX', first4: '3782', last4: '0005' });
    expect(troy).toMatchObject({ brand: 'TROY', first4: '9792', last4: '0003' });
    expect(mastercard).not.toHaveProperty('nickname');
  });

  it('3DS isteyen kart (CHALLENGE_REQUIRED) kaydedilir: 3DS odeme aninda sorulur', async () => {
    const { add } = setup();

    const card = await add({ number: '4000 0027 6000 3184' });

    expect(card).toMatchObject({ last4: '3184', providerToken: 'tok_test_3184' });
  });

  it('son kullanma ayi boyunca kart eklenir (Turkiye saatiyle bu ay)', async () => {
    const { add } = setup();

    await expect(add({ expiryMonth: 10, expiryYear: 2026 })).resolves.toMatchObject({
      expiryMonth: 10,
    });
  });
});

describe('AddCard: red', () => {
  it('saglayici reddi: PAYMENT_DECLINED, reason verification_declined; kart yazilmaz, kasada yer harcanmaz (QA P6)', async () => {
    const { add, repository } = setup();

    await expect(add({ number: '4000 0000 0000 0002' })).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_DECLINED,
      details: { reason: 'verification_declined' },
    });
    expect(await repository.listActive('usr_kasa')).toEqual([]);

    // Kasa hala SAVED_CARDS_MAX kart alir.
    for (let month = 1; month <= SAVED_CARDS_MAX; month += 1) {
      await add({ expiryMonth: month, expiryYear: 2031 });
    }
    expect(await repository.listActive('usr_kasa')).toHaveLength(SAVED_CARDS_MAX);
  });

  it('gecmis kart ve cok ileri yil: VALIDATION_FAILED alan cumlesiyle; saglayiciya gidilmez', async () => {
    const verifier = new CountingVerifier();
    const { add } = setup(verifier);

    await expect(add({ expiryMonth: 9, expiryYear: 2026 })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { expiryMonth: 'Kartın son kullanma tarihi geçmiş' },
    });
    await expect(add({ expiryYear: 2026 + CARD_EXPIRY_MAX_YEARS_AHEAD + 1 })).rejects.toMatchObject(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { expiryYear: 'Son kullanma yılı geçersiz' },
      },
    );
    expect(verifier.calls).toBe(0);
  });

  it('ayni kart ve dolu kasa saglayiciya gitmeden reddedilir; ayni kart CONFLICT ve var olan kimlik', async () => {
    const verifier = new CountingVerifier();
    const { add } = setup(verifier);
    const first = await add();

    await expect(add({ nickname: 'Baska ad' })).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { cardId: first.id },
    });
    for (let month = 1; month < SAVED_CARDS_MAX; month += 1) {
      await add({ expiryMonth: month });
    }
    const before = verifier.calls;
    await expect(add({ expiryMonth: 1, expiryYear: 2032 })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { cards: 'En fazla 10 kart kaydedebilirsin' },
    });
    expect(verifier.calls).toBe(before);
  });

  it('saglayiciya ulasilamazsa SERVICE_UNAVAILABLE; saglayicinin numarali hata metni hatada ve gunlukte yok (QA P1)', async () => {
    const failing: CardVerifier = {
      verifyCard: ({ number, cvv }) =>
        Promise.reject(new TypeError(`kart ${number} / ${cvv} islenemedi`)),
    };
    const { add, lines } = setup(failing);

    const error: unknown = await add().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(error).not.toHaveProperty('cause');
    const visible = withoutRandomNoise(JSON.stringify([error, String(error), lines]));
    for (const secret of ['4242424242424242', '4242 4242', '987', 'islenemedi']) {
      expect(visible).not.toContain(secret);
    }
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'kart dogrulayicisina ulasilamadi',
        fields: { userId: 'usr_kasa', errorType: 'TypeError' },
      }),
    );
  });
});

describe('AddCard: gunluk (QA P1)', () => {
  it('kayit ve red satirlari yalnizca kullanici, kart kimligi ve marka tasir', async () => {
    const { add, lines } = setup();

    const card = await add();
    await add({ number: '4000 0000 0000 0002' }).catch(() => undefined);

    expect(lines).toEqual([
      {
        level: 'info',
        message: 'kart kaydedildi',
        fields: { userId: 'usr_kasa', cardId: card.id, brand: 'VISA' },
      },
      {
        level: 'info',
        message: 'kart dogrulanamadi',
        fields: { userId: 'usr_kasa', brand: 'VISA' },
      },
    ]);
  });
});
