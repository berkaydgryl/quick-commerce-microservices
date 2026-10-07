/**
 * Mock saglayici ve kart uretici numaralari (bekleyen is 112): test kartlari
 * kendi kararini alir; disindaki Luhn'u gecerli, desteklenen markali kart
 * onaylanir ve rastgele jeton (tok_<32 onaltilik>) alir; cekim bu jetonu tanir.
 */

import { cardNumberProblem, CARD_FIELD_MESSAGES } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

const provider = new MockPaymentProvider();
const GENERATED = /^tok_[0-9a-f]{32}$/;

const digitsOf = (number: string) => number.replace(/\D/g, '');
const verify = (number: string) =>
  provider.verifyCard({ number: digitsOf(number), expiryMonth: 12, expiryYear: 2031, cvv: '123' });
const authorize = (cardToken: string) =>
  provider.authorize({ cardToken, amount: { amountMinor: 1_000, currency: 'TRY' } });

/** Onekin sonuna Luhn kontrol hanesini ekler (uretici gibi). */
function withCheckDigit(prefix: string): string {
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = `${prefix}${digit}`;
    if (cardNumberProblem(candidate) === null) {
      return candidate;
    }
  }
  throw new Error(`gecerli kontrol hanesi yok: ${prefix}`);
}

describe('kart uretici numaralari (mock)', () => {
  it.each([
    ['kullanicinin Visa karti', '4532 4786 1188 4096'],
    ['Mastercard 5 serisi', withCheckDigit('542523343010990')],
    ['Mastercard 2 serisi', withCheckDigit('222300312200322')],
    ['Amex', withCheckDigit('37873449367100')],
    ['Troy', withCheckDigit('979212345678901')],
  ])('%s: onaylanir, jeton rastgele ve numaradan bagimsiz', async (_name, number) => {
    const first = await verify(number);
    const second = await verify(number);

    expect(first.decision).toBe('APPROVED');
    expect(first.providerToken).toMatch(GENERATED);
    expect(second.providerToken).toMatch(GENERATED);
    // Ayni numaraya farkli jeton: numaradan TURETILMEDIGININ kaniti (deterministik
    // bir turetme ayni jetonu verirdi). Kisa parcalar rastgele onaltilikta aranmaz.
    expect(second.providerToken).not.toBe(first.providerToken);
    await expect(authorize(first.providerToken)).resolves.toBe('APPROVED');
  });

  it.each([
    ['4000 0000 0000 0002', 'DECLINED', 'tok_test_0002'],
    ['4000 0027 6000 3184', 'CHALLENGE_REQUIRED', 'tok_test_3184'],
    ['3714 496353 98431', 'DECLINED', 'tok_test_8431'],
    ['4242 4242 4242 4242', 'APPROVED', 'tok_test_4242'],
  ])('test karti %s kendi kararini alir: %s', async (number, decision, token) => {
    const verification = await verify(number);

    expect(verification.decision).toBe(decision);
    if (decision !== 'DECLINED') {
      expect(verification.providerToken).toBe(token);
    }
    await expect(authorize(token)).resolves.toBe(decision);
  });

  it.each([
    ['Luhn gecersiz', '4532 4786 1188 4097'],
    ['Discover (desteklenmez)', '6011 1111 1111 1117'],
    ['JCB (desteklenmez)', '3530 1113 3330 0000'],
  ])('%s: mock da reddeder (ikinci emniyet; sema zaten reddeder)', async (_name, number) => {
    await expect(verify(number)).resolves.toEqual({ decision: 'DECLINED', providerToken: '' });
  });

  it('desteklenmeyen marka sozlesmede "Bu kart türü desteklenmiyor" cumlesini alir (web ve kasa)', () => {
    for (const number of ['6011 1111 1111 1117', '3530 1113 3330 0000']) {
      expect(cardNumberProblem(number)).toBe(CARD_FIELD_MESSAGES.brand);
    }
    expect(CARD_FIELD_MESSAGES.brand).toBe('Bu kart türü desteklenmiyor');
  });

  it.each([
    'tok_bilinmeyen',
    'tok_kisa',
    // Nesnenin kalitimsal uyeleri test jetonu sayilmaz.
    '__proto__',
    'constructor',
    'toString',
    `tok_${'A'.repeat(32)}`,
    `tok_${'a'.repeat(33)}`,
    ` tok_${'a'.repeat(32)}`,
    `tok_test_${'a'.repeat(32)}`,
  ])('uretilmis bicimde olmayan jeton %j reddedilir', async (token) => {
    await expect(authorize(token)).resolves.toBe('DECLINED');
  });
});
