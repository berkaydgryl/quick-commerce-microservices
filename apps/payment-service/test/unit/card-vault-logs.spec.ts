/**
 * Kart kasasinin gunlugu (T11.17, QA P1): AddCard'in butun yollarinda (gecerli,
 * Luhn hatasi, saglayici reddi, ayni kart, dolu kasa, ulasilamayan saglayici)
 * ve silmede hicbir satir kart numarasini, parcalarini, CVV'yi, kart uzerindeki
 * adi ve kart adini tasimaz. Gercek gRPC sunucusu; handler'in ve use-case'in
 * butun satirlari (debug dahil) kaydedilir.
 */

import { fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { cardvaultV1 } from '@getir/proto';
import { unaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CardVerifier } from '../../src/domain/card-verifier.js';
import { startCardVault } from '../support/card-vault-grpc-client.js';
import type { RunningCardVault } from '../support/card-vault-grpc-client.js';

const Vault = cardvaultV1.CardVaultServiceService;
const NOW_MS = Date.parse('2026-10-05T12:00:00Z');
const USER = 'usr_gunluk';
const HOLDER = 'Zeynep Kılıçarslan';
const NICKNAME = 'Gizli Maaş';
const CVV = '9183';

const lines: LogLine[] = [];
let vault: RunningCardVault;
let unreachable: RunningCardVault;

const failing: CardVerifier = {
  verifyCard: ({ number, cvv }) => Promise.reject(new Error(`kart ${number} ${cvv} islenemedi`)),
};

function request(overrides: Partial<cardvaultV1.AddCardRequest>): cardvaultV1.AddCardRequest {
  return {
    userId: USER,
    number: '3782 822463 10005',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: CVV,
    holderName: HOLDER,
    nickname: NICKNAME,
    ...overrides,
  };
}

/** Hata nesneleri pino gibi: mesaj ve yigin izi (cause'u da) metne girer. */
function serialized(): string {
  return JSON.stringify(lines, (_key, value: unknown) =>
    value instanceof Error
      ? { message: value.message, stack: value.stack, cause: String(value.cause) }
      : value,
  );
}

beforeAll(async () => {
  const logger = recordingLogger(lines);
  const clock = fixedClock(NOW_MS);
  vault = await startCardVault({ logger, clock }, 'kasa-gunluk');
  unreachable = await startCardVault({ logger, clock, verifier: failing }, 'kasa-gunluk-2');
});

afterAll(async () => {
  await vault?.stop();
  await unreachable?.stop();
});

describe('kart kasasi gunlugu (QA P1)', () => {
  it('butun yollarda kart numarasi, parcalari, CVV, ad ve kart adi gunlukte YOK', async () => {
    const added = await unaryCall(vault.client, Vault.addCard, request({}));
    const cardId = added.response?.card?.id ?? '';
    const paths = [
      request({ number: '3782 822463 10006' }), // Luhn
      request({ number: '4000 0000 0000 0002', cvv: '918' }), // saglayici reddi
      request({}), // ayni kart (CONFLICT)
      request({ nickname: '3782 8224 6310 005' }), // kart adinda numara
    ];
    for (const body of paths) {
      await unaryCall(vault.client, Vault.addCard, body);
    }
    for (let month = 1; month <= 10; month += 1) {
      await unaryCall(
        vault.client,
        Vault.addCard,
        request({ expiryMonth: month, expiryYear: 2030 }),
      );
    }
    await unaryCall(unreachable.client, Vault.addCard, request({}));
    await unaryCall(vault.client, Vault.listCards, { userId: USER });
    await unaryCall(vault.client, Vault.deleteCard, { userId: USER, cardId });

    const text = serialized();
    for (const secret of [
      '378282246310005',
      '3782 822463 10005',
      '378282',
      '822463',
      CVV,
      HOLDER,
      'Kılıçarslan',
      NICKNAME,
      'islenemedi',
    ]) {
      expect(text, `gunlukte: ${secret.length} karakter`).not.toContain(secret);
    }
    // Satirlar gercekten yazildi: her yol gunlukte, yalnizca kimlik ve marka ile.
    const messages = lines.map((line) => line.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'kart kaydedildi',
        'kart dogrulanamadi',
        'kart silindi',
        'kart dogrulayicisina ulasilamadi',
        'rpc is hatasiyla dondu',
        'rpc tamamlandi',
      ]),
    );
    expect(lines.find((line) => line.message === 'kart kaydedildi')?.fields).toMatchObject({
      rpc: 'AddCard',
      userId: USER,
      cardId,
      brand: 'AMEX',
    });
  });
});
