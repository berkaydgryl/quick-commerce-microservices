/**
 * Kart adi duzenleme (#148) uctan uca: gercek gRPC sunucusu + gercek istemci.
 * Kurallar contracts'taki eklemeyle AYNI: NFC'den sonra karakter sayisi (30 |
 * 31), 8+ ardisik rakam yasak (7 | 8; ayraclar atilir). Eksik alan "Kart adı
 * gönderilmedi", bos metin adi kaldirir. Kart yok/baskasinin/silinmis ayni
 * NOT_FOUND. Suresi gecmis kart duzenlenir. Cevap maskeli: numara ve saglayici
 * jetonu yok; hata degeri yankilamaz.
 */

import { CARD_FIELD_MESSAGES, CARD_NICKNAME_MAX_LENGTH } from '@getir/contracts';
import { ERROR_CODES, fixedClock, GRPC_STATUS, ID_PREFIX, newId } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { withoutRandomNoise } from '@getir/core/testing';
import { cardvaultV1 } from '@getir/proto';
import { appErrorOf, unaryCall } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startCardVault, visibleError } from '../support/card-vault-grpc-client.js';
import type { RunningCardVault } from '../support/card-vault-grpc-client.js';

const NOW_MS = Date.parse('2026-10-05T12:00:00Z');
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
const newUser = (): string => {
  users += 1;
  return `usr_ad-${users}`;
};

async function addCard(userId: string, fields: Partial<cardvaultV1.AddCardRequest> = {}) {
  const { error, response } = await call(Vault.addCard, {
    userId,
    number: '4242 4242 4242 4242',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '987',
    holderName: 'Ayşe Yılmaz',
    nickname: 'İlk ad',
    ...fields,
  });
  expect(error).toBeUndefined();
  return response?.card?.id ?? '';
}

const rename = (userId: string, cardId: string, nickname?: string) =>
  call(Vault.updateCardNickname, {
    userId,
    cardId,
    ...(nickname === undefined ? {} : { nickname }),
  });

beforeAll(async () => {
  clock = fixedClock(NOW_MS);
  service = await startCardVault({ clock }, 'card-vault-ad');
});

afterEach(() => {
  // Saati ileri alan test dussa da sonrakiler ayni "simdi"den baslar.
  clock.set(NOW_MS);
});

afterAll(async () => {
  await service?.stop();
});

describe('CardVaultService/UpdateCardNickname (#148)', () => {
  it('ad degisir; cevap guncel MASKELI kart (numara ve saglayici jetonu yok); liste de gunceller', async () => {
    const userId = newUser();
    const cardId = await addCard(userId);

    const { error, response } = await rename(userId, cardId, 'Maaş kartı');

    expect(error).toBeUndefined();
    expect(response?.card).toMatchObject({
      id: cardId,
      nickname: 'Maaş kartı',
      first4: '4242',
      last4: '4242',
      expired: false,
    });
    // Rastgele kart kimligi maskelenir: '987' onun icinde tesadufen gecebilir.
    const text = withoutRandomNoise(JSON.stringify(response));
    expect(text).not.toMatch(/4242 ?4242 ?4242 ?4242|tok_|987/);
    const listed = await call(Vault.listCards, { userId });
    expect(listed.response?.cards.map((card) => card.nickname)).toEqual(['Maaş kartı']);
  });

  it.each([
    ['bos metin', ''],
    ['yalnizca bosluk', '   '],
  ])('%s adi KALDIRIR', async (_name, nickname) => {
    const userId = newUser();
    const cardId = await addCard(userId);

    const { response } = await rename(userId, cardId, nickname);

    expect(response?.card?.nickname).toBe('');
  });

  it('alan yoksa "Kart adı gönderilmedi": INVALID_ARGUMENT, ad DEGISMEZ', async () => {
    const userId = newUser();
    const cardId = await addCard(userId);

    const { error } = await rename(userId, cardId);

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { nickname: CARD_FIELD_MESSAGES.nicknameMissing },
    });
    const listed = await call(Vault.listCards, { userId });
    expect(listed.response?.cards[0]?.nickname).toBe('İlk ad');
  });

  it(`uzunluk siniri NFC'den sonra karakterle: ${CARD_NICKNAME_MAX_LENGTH} gecer, ${CARD_NICKNAME_MAX_LENGTH + 1} reddedilir (deger yankilanmaz)`, async () => {
    const userId = newUser();
    const cardId = await addCard(userId);
    const atLimit = 'a'.repeat(CARD_NICKNAME_MAX_LENGTH);
    const overLimit = 'b'.repeat(CARD_NICKNAME_MAX_LENGTH + 1);
    // Ayristirilmis "e + birlestirici" NFC'de tek karakter: 31 kod birimi, 30 karakter.
    const decomposed = `${'c'.repeat(CARD_NICKNAME_MAX_LENGTH - 1)}e\u0301`;

    expect((await rename(userId, cardId, atLimit)).response?.card?.nickname).toBe(atLimit);
    const over = await rename(userId, cardId, overLimit);
    expect(appErrorOf(over.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(visibleError(over.error)).not.toContain(overLimit);
    const normalized = await rename(userId, cardId, decomposed);
    expect(normalized.error).toBeUndefined();
    expect(normalized.response?.card?.nickname).toBe(decomposed.normalize('NFC'));
  });

  it.each([
    ['7 ardisik rakam gecer', 'Kart 1234567', true],
    ['8 ardisik rakam reddedilir', 'Kart 12345678', false],
    ['ayraclarla bolunmus 8 rakam da reddedilir', 'Kart 1234-5678', false],
  ])('%s', async (_name, nickname, accepted) => {
    const userId = newUser();
    const cardId = await addCard(userId);

    const { error, response } = await rename(userId, cardId, nickname);

    if (accepted) {
      expect(response?.card?.nickname).toBe(nickname);
      return;
    }
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(visibleError(error)).not.toMatch(/1234.?5678/);
  });

  it('kart yok, baskasinin ya da silinmis: AYNI NOT_FOUND; sahibinin karti degismez', async () => {
    const owner = newUser();
    const cardId = await addCard(owner);
    const gone = await addCard(owner, { expiryMonth: 11 });
    await call(Vault.deleteCard, { userId: owner, cardId: gone });

    const results = [
      await rename(newUser(), cardId, 'Yabanci'),
      await rename(owner, gone, 'Dirilt'),
      await rename(owner, newId(ID_PREFIX.CARD), 'Yok'),
      await rename(owner, 'crd_bicimsiz', 'Yok'),
    ];

    for (const { error } of results) {
      expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
      expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(visibleError(error)).not.toMatch(/Yabanci|Dirilt/);
    }
    const listed = await call(Vault.listCards, { userId: owner });
    expect(listed.response?.cards.map((card) => [card.id, card.nickname])).toEqual([
      [cardId, 'İlk ad'],
    ]);
  });

  it('suresi gecmis kartin adi da degisir (K4); tekrar ayni ad sorunsuz', async () => {
    const userId = newUser();
    const cardId = await addCard(userId, { expiryMonth: 11, expiryYear: 2026 });
    clock.set(Date.parse('2027-01-15T12:00:00Z'));

    const first = await rename(userId, cardId, 'Eski kart');
    const again = await rename(userId, cardId, 'Eski kart');

    expect(first.response?.card).toMatchObject({ nickname: 'Eski kart', expired: true });
    expect(again.response?.card).toEqual(first.response?.card);
  });
});
