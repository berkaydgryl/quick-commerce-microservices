/**
 * Kart kasasinin izi (T11.17, QA P7): AddCard'in sunucu span'inde (nitelikler,
 * olaylar, durum) kart numarasi ve CVV yoktur. Saglayici gercek (recordSpans);
 * canli Jaeger denetimi PR 3'un uctan uca testindedir.
 */

import { fixedClock } from '@getir/core';
import { withoutRandomNoise } from '@getir/core/testing';
import { recordSpans } from '@getir/observability/testing';
import type { ReadableSpan } from '@getir/observability/testing';
import { cardvaultV1 } from '@getir/proto';
import { unaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CardVerifier } from '../../src/domain/card-verifier.js';
import { startCardVault } from '../support/card-vault-grpc-client.js';
import type { RunningCardVault } from '../support/card-vault-grpc-client.js';

// Saglayici, sunucu kurulmadan ONCE (recordSpans belgesi).
const spans = recordSpans();

const Vault = cardvaultV1.CardVaultServiceService;
const CVV = '9183';
/** 5 Ekim 2026 12.00 UTC. */
const NOW_MS = Date.parse('2026-10-05T12:00:00Z');

let vault: RunningCardVault;
let unreachable: RunningCardVault;

const failing: CardVerifier = {
  verifyCard: ({ number }) => Promise.reject(new Error(`kart ${number} islenemedi`)),
};

function request(overrides: Partial<cardvaultV1.AddCardRequest>): cardvaultV1.AddCardRequest {
  return {
    userId: 'usr_iz',
    number: '3782 822463 10005',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: CVV,
    holderName: 'Zeynep Kılıçarslan',
    nickname: 'Gizli Maaş',
    ...overrides,
  };
}

/** Span'in disari giden her parcasi (sure ve kaynak haric). */
function visible(span: ReadableSpan): unknown {
  return {
    name: span.name,
    attributes: span.attributes,
    status: span.status,
    events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
    links: span.links.map((link) => link.attributes),
  };
}

beforeAll(async () => {
  // Sabit saat (QA D4): gercek saatle kartlarin son kullanma tarihi bir gun gecer.
  const clock = fixedClock(NOW_MS);
  vault = await startCardVault({ clock }, 'kasa-iz');
  unreachable = await startCardVault({ clock, verifier: failing }, 'kasa-iz-2');
});

afterAll(async () => {
  await vault?.stop();
  await unreachable?.stop();
});

describe('kart kasasi izi (QA P7)', () => {
  it('AddCard span larinda (onay, Luhn, ret, ayni kart, ulasilamayan saglayici) numara ve CVV yok', async () => {
    spans.reset();
    for (const body of [
      request({}),
      request({ number: '3782 822463 10006' }),
      request({ number: '4000 0000 0000 0002', cvv: '918' }),
      request({}),
    ]) {
      await unaryCall(vault.client, Vault.addCard, body);
    }
    await unaryCall(unreachable.client, Vault.addCard, request({ expiryMonth: 1 }));

    const addCard = spans
      .finished()
      .filter((span) => span.name === 'getir.cardvault.v1.CardVaultService/AddCard');
    expect(addCard).toHaveLength(5);
    // Istek kimligi (app.request_id) rastgele: kisa sir onun icinde tesadufen gecebilir.
    const text = withoutRandomNoise(JSON.stringify(addCard.map(visible)));
    for (const secret of ['378282246310005', '378282', '822463', CVV, 'Kılıçarslan', 'Gizli']) {
      expect(text, `izde: ${secret.length} karakter`).not.toContain(secret);
    }
  });
});
