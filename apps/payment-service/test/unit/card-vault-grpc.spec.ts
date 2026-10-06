/**
 * Kart kasasi uctan uca (T11.17): gercek gRPC sunucusu + gercek istemci.
 * QA kabul olcutleri: P2 (cevap maskeli, saglayici jetonu yok), P3 (hata
 * ayrintisi ve x-app-error degeri yankilamaz), P4 (ayni kart kullanici
 * basina), P5 (silme), P6 (ret), P8 (kart adinda numara ve bicim karakteri).
 */

import { CARD_FIELD_MESSAGES, SAVED_CARDS_MAX } from '@getir/contracts';
import { ERROR_CODES, fixedClock, GRPC_STATUS, ID_PREFIX, newId } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { cardvaultV1 } from '@getir/proto';
import { appErrorOf, unaryCall } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startCardVault } from '../support/card-vault-grpc-client.js';
import type { RunningCardVault } from '../support/card-vault-grpc-client.js';

/** 5 Ekim 2026 12.00 UTC. */
const NOW_MS = Date.parse('2026-10-05T12:00:00Z');
const ERROR_METADATA_KEY = 'x-app-error';

const Vault = cardvaultV1.CardVaultServiceService;

let service: RunningCardVault;
let clock: MutableClock;

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return unaryCall(service.client, method, request);
}

let users = 0;
function newUser(): string {
  users += 1;
  return `usr_grpc-${users}`;
}

function addRequest(
  userId: string,
  overrides: Partial<cardvaultV1.AddCardRequest> = {},
): cardvaultV1.AddCardRequest {
  return {
    userId,
    number: '4242 4242 4242 4242',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '987',
    holderName: 'Ayşe Yılmaz',
    nickname: '',
    ...overrides,
  };
}

/** Hatanin disari giden her parcasi: durum metni, mesaj ve x-app-error yuku. */
function visibleError(error: ServiceError | undefined): string {
  return JSON.stringify([
    error?.message,
    error?.details,
    error?.metadata.get(ERROR_METADATA_KEY).map((value) => value.toString()),
  ]);
}

beforeAll(async () => {
  clock = fixedClock(NOW_MS);
  service = await startCardVault({ clock });
});

afterAll(async () => {
  await service?.stop();
});

describe('CardVaultService/AddCard', () => {
  it('maskeli kart doner: marka, ilk 4, son 4, ad; saglayici jetonu ve numara cevapta yok (QA P2)', async () => {
    const userId = newUser();

    const { error, response } = await call(
      Vault.addCard,
      addRequest(userId, { nickname: '  Maaş kartım ' }),
    );

    expect(error).toBeUndefined();
    expect(response?.card).toMatchObject({
      brand: cardvaultV1.CardBrand.CARD_BRAND_VISA,
      first4: '4242',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: 2031,
      holderName: 'Ayşe Yılmaz',
      nickname: 'Maaş kartım',
      expired: false,
      createdAt: new Date(NOW_MS),
    });
    expect(response?.card?.id).toMatch(/^crd_[0-9a-f]{32}$/);
    const body = JSON.stringify(response);
    for (const secret of ['tok_', '4242424242424242', '987', 'providerToken']) {
      expect(body).not.toContain(secret);
    }
  });

  it('bos kart adi cevapta bos metin (proto: kart adi yok)', async () => {
    const { response } = await call(Vault.addCard, addRequest(newUser(), { nickname: '   ' }));

    expect(response?.card?.nickname).toBe('');
  });

  it('saglayici reddi: FAILED_PRECONDITION + PAYMENT_DECLINED, reason genel; kart listede yok (QA P6)', async () => {
    const userId = newUser();

    const { error } = await call(
      Vault.addCard,
      addRequest(userId, { number: '4000 0000 0000 0002' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.PAYMENT_DECLINED,
      details: { reason: 'verification_declined' },
    });
    const { response } = await call(Vault.listCards, { userId });
    expect(response?.cards).toEqual([]);
  });

  it('ayni kart: ABORTED + CONFLICT, details.cardId kullanicinin KENDI karti; baska kullanicida serbest (QA P4)', async () => {
    const owner = newUser();
    const first = await call(Vault.addCard, addRequest(owner));

    const again = await call(Vault.addCard, addRequest(owner, { nickname: 'Ikinci' }));
    const other = await call(Vault.addCard, addRequest(newUser()));

    expect(again.error?.code).toBe(GRPC_STATUS.ABORTED);
    expect(appErrorOf(again.error)).toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { cardId: first.response?.card?.id },
    });
    expect(other.error).toBeUndefined();
    expect(other.response?.card?.id).not.toBe(first.response?.card?.id);
  });

  it(`kasa dolu: ${SAVED_CARDS_MAX + 1}. kart VALIDATION_FAILED, details.cards`, async () => {
    const userId = newUser();
    for (let month = 1; month <= SAVED_CARDS_MAX; month += 1) {
      const { error } = await call(Vault.addCard, addRequest(userId, { expiryMonth: month }));
      expect(error).toBeUndefined();
    }

    const { error } = await call(Vault.addCard, addRequest(userId, { expiryYear: 2032 }));

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.details).toEqual({ cards: CARD_FIELD_MESSAGES.cards });
  });

  it('gecersiz istek alan -> cumle; durum metninde, ayrintida ve x-app-error yukunde girilen deger YOK (QA P3)', async () => {
    const cases: readonly (readonly [
      Partial<cardvaultV1.AddCardRequest>,
      Record<string, string>,
    ])[] = [
      [{ number: '4242 4242 4242 4241', cvv: '987' }, { number: CARD_FIELD_MESSAGES.number }],
      [{ number: '4000000000000000026', cvv: '5310' }, { number: CARD_FIELD_MESSAGES.number }],
      [{ number: '400000000000000002', cvv: '5310' }, { number: CARD_FIELD_MESSAGES.numberLength }],
      [{ number: '378282246310005', cvv: '765' }, { cvv: CARD_FIELD_MESSAGES.cvv }],
      [{ number: '6011000000000004', cvv: '4321' }, { number: CARD_FIELD_MESSAGES.brand }],
      [{ number: '4242424242424242', cvv: '98a' }, { cvv: CARD_FIELD_MESSAGES.cvv }],
    ];
    for (const [overrides, details] of cases) {
      const { error } = await call(Vault.addCard, addRequest(newUser(), overrides));

      expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      expect(appErrorOf(error)?.details).toEqual(details);
      const visible = visibleError(error);
      const digits = String(overrides.number).replace(/\D/g, '');
      for (const secret of [
        overrides.number,
        digits,
        digits.slice(0, 6),
        digits.slice(-4),
        overrides.cvv,
      ]) {
        expect(visible, `yankilanan ${String(secret).length} karakter`).not.toContain(secret);
      }
    }
  });

  it('kart adinda kart numarasi (bosluklu, tireli, noktali) ve U+202E reddedilir; cumle degeri yankilamaz (QA P8)', async () => {
    const cases = [
      ['Kart 4242 4242 4242 4242', CARD_FIELD_MESSAGES.nicknameDigits],
      ['4242-4242-4242-4242', CARD_FIELD_MESSAGES.nicknameDigits],
      ['4242.4242.4242.4242', CARD_FIELD_MESSAGES.nicknameDigits],
      ['Maaş‮kartı', CARD_FIELD_MESSAGES.nicknameCharacters],
      ['Maaş​kartı', CARD_FIELD_MESSAGES.nicknameCharacters],
    ] as const;
    for (const [nickname, message] of cases) {
      const { error } = await call(Vault.addCard, addRequest(newUser(), { nickname }));

      expect(appErrorOf(error)).toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { nickname: message },
      });
      const visible = visibleError(error);
      expect(visible).not.toContain('4242');
      expect(visible).not.toContain('‮');
      expect(visible).not.toContain('\\u202e');
    }
  });

  it('gecmis kart VALIDATION_FAILED (expiryMonth); kullanici kimligi zorunlu', async () => {
    const expired = await call(
      Vault.addCard,
      addRequest(newUser(), { expiryMonth: 9, expiryYear: 2026 }),
    );
    const anonymous = await call(Vault.addCard, addRequest(''));

    expect(appErrorOf(expired.error)?.details).toEqual({
      expiryMonth: CARD_FIELD_MESSAGES.expired,
    });
    expect(appErrorOf(anonymous.error)?.details).toEqual({ userId: 'userId zorunlu' });
  });
});

describe('CardVaultService/ListCards ve DeleteCard', () => {
  it('liste yeniden eskiye; silme guncel listeyi doner (QA P5)', async () => {
    const userId = newUser();
    const first = await call(Vault.addCard, addRequest(userId, { expiryMonth: 1 }));
    clock.advance(1_000);
    const second = await call(Vault.addCard, addRequest(userId, { expiryMonth: 2 }));

    const listed = await call(Vault.listCards, { userId });
    const deleted = await call(Vault.deleteCard, {
      userId,
      cardId: second.response?.card?.id ?? '',
    });

    expect(listed.response?.cards.map((card) => card.id)).toEqual([
      second.response?.card?.id,
      first.response?.card?.id,
    ]);
    expect(deleted.error).toBeUndefined();
    expect(deleted.response?.cards.map((card) => card.id)).toEqual([first.response?.card?.id]);
  });

  it('baskasinin karti, olmayan, bicim disi ve silinmis kart: NOT_FOUND; kart yerinde kalir (QA P5)', async () => {
    const owner = newUser();
    const { response } = await call(Vault.addCard, addRequest(owner));
    const cardId = response?.card?.id ?? '';

    const foreign = await call(Vault.deleteCard, { userId: newUser(), cardId });
    const unknown = await call(Vault.deleteCard, { userId: owner, cardId: newId(ID_PREFIX.CARD) });
    const malformed = await call(Vault.deleteCard, { userId: owner, cardId: 'crd_$ne' });
    await call(Vault.deleteCard, { userId: owner, cardId });
    const twice = await call(Vault.deleteCard, { userId: owner, cardId });

    for (const result of [foreign, unknown, malformed, twice]) {
      expect(result.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
      expect(appErrorOf(result.error)?.code).toBe(ERROR_CODES.NOT_FOUND);
    }
    const empty = await call(Vault.deleteCard, { userId: owner, cardId: '' });
    expect(appErrorOf(empty.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('silinen kart yeniden eklenebilir (QA P5)', async () => {
    const userId = newUser();
    const { response } = await call(Vault.addCard, addRequest(userId));
    await call(Vault.deleteCard, { userId, cardId: response?.card?.id ?? '' });

    const again = await call(Vault.addCard, addRequest(userId));

    expect(again.error).toBeUndefined();
    expect(again.response?.card?.id).not.toBe(response?.card?.id);
  });

  it('expired okuma anina gore: son kullanma ayi bitince true (Turkiye saatiyle)', async () => {
    const userId = newUser();
    await call(Vault.addCard, addRequest(userId, { expiryMonth: 10, expiryYear: 2026 }));
    const before = await call(Vault.listCards, { userId });

    // 31 Ekim 21.00 UTC = 1 Kasim 00.00 Istanbul.
    clock.advance(Date.parse('2026-10-31T21:00:00Z') - clock.now());
    const after = await call(Vault.listCards, { userId });

    expect(before.response?.cards[0]?.expired).toBe(false);
    expect(after.response?.cards[0]?.expired).toBe(true);
  });
});
