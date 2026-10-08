/**
 * 3DS'i yenilemede surdurme (F15b, #163; PM sartlari 1-3): sekmede yalniz
 * siparis kimligi; karar sunucunun cevabindan (ayni challenge, sunucunun kalan
 * hakki ve suresi; odendiyse basari, incelemedeyse inceleme, kodun suresi
 * dolduysa birakma); 404 ve uyusmayan kimlik sessizce birakilir. Kalan hak
 * HER ZAMAN sunucudan: istemci 3'ten baslamaz. Kod ve challengeId depoya ya da
 * adrese girmez.
 */

import { CONTENT_FALLBACK, orderSchema } from '@getir/contracts';
import type { Order, OrderStatus } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPendingThreeDs,
  readPendingThreeDs,
  savePendingThreeDs,
} from '../../src/features/checkout/services/pending-three-ds';
import {
  closedThreeDsNotice,
  RESUME_RETRY_DELAY_MS,
  RESUME_RETRY_LIMIT,
  resumeDecision,
  resumeNextStep,
} from '../../src/features/checkout/services/resume-three-ds';
import { fetchOrder } from '../../src/features/orders/api/orders.api';
import { formatCountdown } from '../../src/features/profile/services/code-window';
import { retryWaitSeconds } from '../../src/features/cards/services/card-form';
import { placeHints } from '../../src/features/checkout/services/retry-wait';
import {
  canSubmitCode,
  codeFailureNotice,
} from '../../src/features/checkout/services/three-ds-code';
import { OrderSummaryCard } from '../../src/features/checkout/ui/OrderSummaryCard';
import { ThreeDsDialog } from '../../src/features/checkout/ui/ThreeDsDialog';
import { createHttpClient } from '../../src/shared/api/http-client';

import { ORDER, ORDER_ID } from './order-test-support';

const NOW = 1_000_000;
const awaiting = (threeDs?: Order['threeDs'], ttl?: number): Order => ({
  ...ORDER,
  status: 'AWAITING_PAYMENT',
  ...(threeDs === undefined ? {} : { threeDs }),
  ...(ttl === undefined ? {} : { reservationTtlSeconds: ttl }),
});
const decide = (order: Order) => resumeDecision(ORDER_ID, { order }, NOW);
/** Sozlesmenin jeton bicimi: tds_ + 32 onaltilik. */
const CHL = `tds_${'a'.repeat(32)}`;
/** Sunucudan gelen cevap gibi: sozlesmenin semasindan gecer (kapali durumda jeton atilir). */
const parsed = (threeDs: unknown): Order => orderSchema.parse({ ...awaiting(), threeDs });

describe('bekleyen 3DS kaydi (sekme deposu; PM sart 2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    return store;
  }

  it('YALNIZ siparis kimligi yazilir; okunur ve silinir', () => {
    const store = stubStorage();

    savePendingThreeDs(ORDER_ID);
    expect([...store.entries()]).toEqual([['getir.pending-3ds', ORDER_ID]]);
    expect(readPendingThreeDs()).toBe(ORDER_ID);
    clearPendingThreeDs();
    expect(store.size).toBe(0);
    expect(readPendingThreeDs()).toBeUndefined();
  });

  it('bicimi siparis kimligine uymayan kayit yok sayilir (elle yazilmis deger)', () => {
    const store = stubStorage();

    store.set('getir.pending-3ds', 'chl_123456');
    expect(readPendingThreeDs()).toBeUndefined();
  });

  it('depo yoksa (ozel mod) akis bozulmaz', () => {
    expect(() => savePendingThreeDs(ORDER_ID)).not.toThrow();
    expect(readPendingThreeDs()).toBeUndefined();
    expect(() => clearPendingThreeDs()).not.toThrow();
  });

  it('depo siniri: yalniz siparis kimligi bicimi yazilir; kod ya da jeton YAZILMAZ', () => {
    const store = stubStorage();

    savePendingThreeDs(CHL);
    savePendingThreeDs('123456');
    expect(store.size).toBe(0);
    savePendingThreeDs(ORDER_ID);
    expect([...store.values()]).toEqual([ORDER_ID]);
  });
});

describe('surdurme karari (F15b; #163 B1 anlam tablosu)', () => {
  it('acik dogrulama: ayni challenge, SUNUCUNUN kalan hakki ve suresi', () => {
    expect(decide(awaiting({ challengeId: CHL, ttlSeconds: 40, attemptsLeft: 2 }))).toEqual({
      kind: 'challenge',
      orderId: ORDER_ID,
      challengeId: CHL,
      deadline: NOW + 40_000,
      attemptsLeft: 2,
    });
  });

  it("kalan hak sunucudan: 1 hak kaldiysa pencere 1 der, istemci 3'ten BASLAMAZ (PM sart 1)", () => {
    const decision = decide(awaiting({ challengeId: CHL, ttlSeconds: 40, attemptsLeft: 1 }));

    expect(decision.kind === 'challenge' ? decision.attemptsLeft : 0).toBe(1);
  });

  it('sure kodun ve stok kilidinin erken bitenine gore', () => {
    const decision = decide(awaiting({ challengeId: CHL, ttlSeconds: 50, attemptsLeft: 3 }, 20));

    expect(decision.kind === 'challenge' ? decision.deadline : 0).toBe(NOW + 20_000);
  });

  it('kapali dogrulama birakilir; metin sunucunun anlamiyla: hak 0 "hakkı bitti" (sure de dolmus olsa), aksi halde "süresi doldu"', () => {
    const cases: readonly [unknown, 'expired' | 'exhausted'][] = [
      [{ challengeId: CHL, ttlSeconds: 0, attemptsLeft: 2 }, 'expired'],
      [{ challengeId: CHL, ttlSeconds: 30, attemptsLeft: 0 }, 'exhausted'],
      [{ ttlSeconds: 0, attemptsLeft: 0 }, 'exhausted'],
      // Saat yarisi: jeton yok ama sure ve hak var; yine kapali (sozlesme).
      [{ ttlSeconds: 30, attemptsLeft: 2 }, 'expired'],
    ];
    for (const [threeDs, reason] of cases) {
      expect(decide(parsed(threeDs)), JSON.stringify(threeDs)).toEqual({
        kind: 'closed',
        orderId: ORDER_ID,
        reason,
      });
    }
    expect(closedThreeDsNotice('exhausted', CONTENT_FALLBACK.checkout)).toBe(
      'Doğrulama hakkın bitti; siparişini yeniden verebilirsin.',
    );
    expect(closedThreeDsNotice('expired', CONTENT_FALLBACK.checkout)).toBe(
      'Doğrulama süresi doldu; siparişini yeniden verebilirsin.',
    );
  });

  it('threeDs alani YOK: bilinmiyor, siparis BIRAKILMAZ (gecici kesinti iptal etmesin)', () => {
    expect(decide(awaiting())).toEqual({ kind: 'unknown' });
  });

  it('odendiyse basari, incelemedeyse inceleme; son ve diger durumlarda kayit sessizce silinir', () => {
    const statuses: OrderStatus[] = [
      'PAID',
      'PREPARING',
      'ON_THE_WAY',
      'DELIVERED',
      'REVIEW',
      'CANCELLED',
      'PAYMENT_FAILED',
      'EXPIRED',
      'RISK_CHECK',
    ];

    expect(statuses.map((status) => decide({ ...ORDER, status }).kind)).toEqual([
      'paid',
      'paid',
      'paid',
      'paid',
      'review',
      'gone',
      'gone',
      'gone',
      'gone',
    ]);
  });

  it('kayittaki kimlik sunucuyla dogrulanir: 404 ve uyusmayan kimlik sessizce birakilir (PM sart 3)', () => {
    expect(
      resumeDecision(ORDER_ID, { error: new AppError(ERROR_CODES.NOT_FOUND, 'x') }, NOW),
    ).toEqual({ kind: 'gone' });
    expect(
      resumeDecision(
        'ord_0000000000000000000000000000ffff',
        { order: awaiting({ challengeId: 'c', ttlSeconds: 30, attemptsLeft: 3 }) },
        NOW,
      ),
    ).toEqual({ kind: 'gone' });
  });

  it('gecici hata da bilinmiyor: siparis birakilmaz, yeniden denenir', () => {
    expect(
      resumeDecision(ORDER_ID, { error: new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x') }, NOW),
    ).toEqual({ kind: 'unknown' });
    expect(resumeDecision(ORDER_ID, { error: new Error('ag') }, NOW)).toEqual({ kind: 'unknown' });
  });
});

describe('bilinmeyen durumda yeniden deneme (3 x 2 sn, sonra uyari)', () => {
  it('3 kez yeniden denenir, sonra uyari; karar varsa uygulanir', () => {
    const unknown = { kind: 'unknown' } as const;

    expect([0, 1, 2, 3].map((done) => resumeNextStep(unknown, done))).toEqual([
      'retry',
      'retry',
      'retry',
      'fail',
    ]);
    expect(resumeNextStep({ kind: 'gone' }, 0)).toBe('apply');
    expect(resumeNextStep({ kind: 'closed', orderId: ORDER_ID, reason: 'expired' }, 3)).toBe(
      'apply',
    );
    expect([RESUME_RETRY_LIMIT, RESUME_RETRY_DELAY_MS]).toEqual([3, 2_000]);
  });
});

describe('bekleyen siparisi okuma (sozlesmenin semasi; #163 B1)', () => {
  it('GET /v1/orders/{id}; threeDs atilmaz; adreste yalniz kimlik', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: awaiting({ challengeId: CHL, ttlSeconds: 40, attemptsLeft: 2 }),
        }),
      ),
    );
    const order = await fetchOrder(createHttpClient({ baseUrl: '', fetch: fetchMock }), ORDER_ID);
    const [input] = fetchMock.mock.calls[0] ?? [];

    expect(typeof input === 'string' ? input : '').toBe(`/v1/orders/${ORDER_ID}`);
    expect(order.threeDs).toEqual({ challengeId: CHL, ttlSeconds: 40, attemptsLeft: 2 });
  });
});

describe('3DS penceresi: surdurulende kalan hak (F15b)', () => {
  const dialog = (props: {
    attemptsLeft?: number;
    failure?: { message: string; attemptsLeft: number };
    waitSeconds?: number;
  }) =>
    renderToStaticMarkup(
      createElement(ThreeDsDialog, {
        texts: CONTENT_FALLBACK.checkout,
        remaining: 40,
        verifying: false,
        failure: props.failure,
        ...(props.attemptsLeft === undefined ? {} : { attemptsLeft: props.attemptsLeft }),
        ...(props.waitSeconds === undefined ? {} : { waitSeconds: props.waitSeconds }),
        onSubmit: () => undefined,
        onCancel: () => undefined,
      }),
    );

  it('sunucunun kalan hakki gorunur; yoksa sayi yok', () => {
    expect(dialog({ attemptsLeft: 2 })).toContain('2 deneme hakkın kaldı');
    expect(dialog({})).not.toContain('deneme hakkın kaldı');
  });

  it('yanlis kod cumlesi varken yalniz o (iki kez yazilmaz)', () => {
    const html = dialog({
      attemptsLeft: 2,
      failure: { message: 'Kod geçersiz.', attemptsLeft: 1 },
    });

    expect(html.match(/deneme hakkın kaldı/g)).toHaveLength(1);
    expect(html).toContain('Kod geçersiz. 1 deneme hakkın kaldı');
  });
});

describe('cok fazla hatali kod (429 + Retry-After; F15b)', () => {
  const dialog = (waitSeconds?: number) =>
    renderToStaticMarkup(
      createElement(ThreeDsDialog, {
        texts: CONTENT_FALLBACK.checkout,
        remaining: 40,
        verifying: false,
        failure: undefined,
        ...(waitSeconds === undefined ? {} : { waitSeconds }),
        onSubmit: () => undefined,
        onCancel: () => undefined,
      }),
    );

  it('pencerede uyari ve geri sayim; "Onayla" pasif', () => {
    const html = dialog(125);

    expect(html).toContain('Çok fazla hatalı kod girdin.');
    expect(html).toContain('Yeniden deneyebilmen için <time>2:05</time>');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(dialog()).not.toContain('Çok fazla hatalı kod girdin.');
  });

  it('bekleme surerken 6 haneli kod da gonderilemez; bekleme bitince gonderilir', () => {
    expect(canSubmitCode('123456', false, 125)).toBe(false);
    expect(canSubmitCode('123456', false, 0)).toBe(true);
    expect(canSubmitCode('12345', false, 0)).toBe(false);
    expect(canSubmitCode('123456', true, 0)).toBe(false);
  });

  const texts = CONTENT_FALLBACK.checkout;
  const blocker = texts.blockerAgreementNotice;

  it('"Sipariş Ver"in altinda: bostayken once 429 beklemesi, sonra eksik kosul', () => {
    expect(placeHints({ idle: true, byCard: true, waitSeconds: 61 }, blocker, texts)).toEqual({
      blocker: undefined,
      wait: {
        notice: 'Çok fazla hatalı kod girdin.',
        label: 'Yeniden deneyebilmen için',
        seconds: 61,
      },
    });
    expect(placeHints({ idle: true, byCard: true, waitSeconds: 0 }, blocker, texts)).toEqual({
      blocker,
      wait: undefined,
    });
  });

  it('kapida odemede 429 beklemesi yok: gateway kapisi yalniz kartli siparisi durdurur', () => {
    expect(placeHints({ idle: true, byCard: false, waitSeconds: 61 }, blocker, texts)).toEqual({
      blocker,
      wait: undefined,
    });
  });

  it('saatlerce suren bekleme saatle yazilir (gunluk sinir)', () => {
    expect([formatCountdown(3599), formatCountdown(3600), formatCountdown(86_000)]).toEqual([
      '59:59',
      '1:00:00',
      '23:53:20',
    ]);
  });

  it('canli yolda hak bitince de "hakkın bitti" (yenilemedekiyle ayni metin)', () => {
    const exhausted = new AppError(ERROR_CODES.THREEDS_FAILED, 'Doğrulama kodu geçersiz.', {
      details: { attemptsLeft: 0 },
    });

    expect(codeFailureNotice(exhausted, texts)).toBe(
      'Doğrulama hakkın bitti; siparişini yeniden verebilirsin.',
    );
    expect(codeFailureNotice(new AppError(ERROR_CODES.INTERNAL, 'Sunucu cümlesi'), texts)).toBe(
      'Sunucu cümlesi',
    );
  });

  it('akis bosta degilken (ucusta, 3DS, surdurme) satir yok: "Sipariş veriliyor…" ile celismez', () => {
    for (const waitSeconds of [0, 61]) {
      expect(placeHints({ idle: false, byCard: true, waitSeconds }, blocker, texts)).toEqual({
        blocker: undefined,
        wait: undefined,
      });
    }
  });

  it('dugme altinda cumle BIR kez okunur (role="alert"), geri sayim bolgenin disinda; dugme pasif', () => {
    const html = renderToStaticMarkup(
      createElement(OrderSummaryCard, {
        totals: undefined,
        agreementsAccepted: true,
        onAgreementsChange: () => undefined,
        texts,
        ...placeHints({ idle: true, byCard: true, waitSeconds: 61 }, undefined, texts),
        busy: false,
        onPlace: () => undefined,
      }),
    );

    expect(html).toContain(
      '<span role="alert">Çok fazla hatalı kod girdin.</span> Yeniden deneyebilmen için <time>1:01</time>',
    );
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-describedby="([^"]+)"/);
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<p id="${described}"`);
  });

  it('bekleme yalniz RATE_LIMITED ayrintisindan (kart ekleme deseniyle ayni)', () => {
    const limited = new AppError(ERROR_CODES.RATE_LIMITED, 'x', {
      details: { retryAfterSeconds: 90 },
    });

    expect(retryWaitSeconds(limited)).toBe(90);
    expect(retryWaitSeconds(new AppError(ERROR_CODES.INTERNAL, 'x'))).toBeNull();
  });
});
