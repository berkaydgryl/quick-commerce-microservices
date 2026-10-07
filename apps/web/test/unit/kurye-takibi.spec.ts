/**
 * Kurye takibi mantigi (F22): sayilar ("~8 dk", "1,2 km", "300 m"), kisaltilmis
 * ad, yoklama (pencere acikken 2 sn, kapaliyken kurye yolda 10 sn; teslimde
 * ve takip yokken durur), yaklasma bildirimi bir kez ve depoda yalniz siparis
 * kimligi bayragi (konum gizliligi, QA K9).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrderTracking } from '@getir/contracts';
import { environmentManager, focusManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../src/app/query-client';
import {
  orderTrackingQuery,
  trackingMode,
  trackingPollInterval,
} from '../../src/features/tracking/api/queries';
import type { TrackingMode } from '../../src/features/tracking/api/queries';
import {
  APPROACH_NOTICE_MS,
  TRACKING_POLL_OPEN_MS,
  TRACKING_POLL_WATCH_MS,
} from '../../src/features/tracking/constants';
import {
  approachDecision,
  approachNotified,
  markApproachNotified,
  resetApproachMemory,
} from '../../src/features/tracking/services/approach-once';
import { courierMapState } from '../../src/features/tracking/services/map-state';
import { trackingErrorKind } from '../../src/features/tracking/services/tracking-errors';
import {
  focusAfterClose,
  noticePaused,
  refetchOnModeChange,
} from '../../src/features/tracking/services/notice-rules';
import {
  courierDisplayName,
  distanceText,
  etaText,
} from '../../src/features/tracking/services/tracking-format';
import { createHttpClient } from '../../src/shared/api/http-client';

import { DELIVERED, TO_CUSTOMER, TO_MARKET, TRACKED_ORDER } from './tracking-test-support';

const TEXTS = CONTENT_FALLBACK.courierTracking;
const USER = 'usr_00000000000000000000000000000001';

describe('sayilar ve ad (F22)', () => {
  it('tahmini varis dakikaya yukari yuvarlanir, en az 1: "~8 dk"', () => {
    expect(etaText(451, TEXTS)).toBe('~8 dk');
    expect(etaText(480, TEXTS)).toBe('~8 dk');
    expect(etaText(481, TEXTS)).toBe('~9 dk');
    expect(etaText(20, TEXTS)).toBe('~1 dk');
    expect(etaText(0, TEXTS)).toBe('~1 dk');
  });

  it('kalan mesafe: 1 km altinda 10 m adimli metre, ustunde tek ondalikli km', () => {
    expect(distanceText(280, TEXTS)).toBe('280 m');
    expect(distanceText(296, TEXTS)).toBe('300 m');
    expect(distanceText(0, TEXTS)).toBe('0 m');
    expect(distanceText(996, TEXTS)).toBe('1,0 km');
    expect(distanceText(1_234, TEXTS)).toBe('1,2 km');
    expect(distanceText(12_345, TEXTS)).toBe('12,3 km');
  });

  it('kurye adi kisaltilir (kisisel veri asgari): "Mehmet Kaya" -> "Mehmet K."', () => {
    expect(courierDisplayName('Mehmet Kaya')).toBe('Mehmet K.');
    expect(courierDisplayName('Mehmet K.')).toBe('Mehmet K.');
    expect(courierDisplayName('Ayşe Nur Yılmaz')).toBe('Ayşe Nur Y.');
    expect(courierDisplayName('ali şahin')).toBe('ali Ş.');
    expect(courierDisplayName('  Mehmet  ')).toBe('Mehmet');
  });
});

describe('yoklama araligi (F22)', () => {
  const notFound = new AppError(ERROR_CODES.NOT_FOUND, 'x');

  it('acik 2 sn, izle (kapali, kurye yolda) 10 sn, kapali yok', () => {
    expect(TRACKING_POLL_OPEN_MS).toBe(2_000);
    expect(TRACKING_POLL_WATCH_MS).toBe(10_000);
    expect(trackingPollInterval('open', TO_CUSTOMER, null)).toBe(2_000);
    expect(trackingPollInterval('watch', TO_CUSTOMER, null)).toBe(10_000);
    expect(trackingPollInterval('off', TO_CUSTOMER, null)).toBe(false);
  });

  it('sozlesme: teslimde ve takip yokken (404) BIRAKILIR; gecici hatada surer', () => {
    expect(trackingPollInterval('open', DELIVERED, null)).toBe(false);
    expect(trackingPollInterval('open', undefined, notFound)).toBe(false);
    expect(
      trackingPollInterval('open', TO_MARKET, new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x')),
    ).toBe(2_000);
  });
});

describe('yoklama bicimi ve pencere icerigi (F22 code-review)', () => {
  it('pencere acik: 2 sn; siparis son durumdaysa yalniz bir kez; kapali: yoldaysa 10 sn', () => {
    expect(trackingMode(true, 'ON_THE_WAY')).toBe('open');
    expect(trackingMode(true, 'DELIVERED')).toBe('once');
    expect(trackingMode(true, 'CANCELLED')).toBe('once');
    expect(trackingMode(false, 'ON_THE_WAY')).toBe('watch');
    expect(trackingMode(false, 'PREPARING')).toBe('off');
    expect(trackingPollInterval('once', TO_CUSTOMER, null)).toBe(false);
  });

  it('hata turu: 503 ve ag gecici; 404, yetki ve gecersiz cevap (INTERNAL) son', () => {
    expect(trackingErrorKind(null)).toBe('none');
    expect(trackingErrorKind(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x'))).toBe('transient');
    expect(trackingErrorKind(new Error('ag'))).toBe('transient');
    for (const code of [ERROR_CODES.NOT_FOUND, ERROR_CODES.FORBIDDEN, ERROR_CODES.INTERNAL]) {
      expect(trackingErrorKind(new AppError(code, 'x')), code).toBe('final');
    }
    expect(trackingPollInterval('open', TO_CUSTOMER, new AppError(ERROR_CODES.INTERNAL, 'x'))).toBe(
      false,
    );
  });

  it('pencere icerigi (B2): son hata "alinamadi"; gecici hata yoklama surerken cizimi korur', () => {
    const transient = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');
    const internal = new AppError(ERROR_CODES.INTERNAL, 'x');
    const missing = new AppError(ERROR_CODES.NOT_FOUND, 'x');
    const state = (
      data: OrderTracking | undefined,
      error: unknown,
      dataAt: number,
      errorAt: number,
      polling = true,
    ) =>
      courierMapState({ data, error, dataUpdatedAt: dataAt, errorUpdatedAt: errorAt, polling })
        .kind;

    expect(state(undefined, null, 0, 0)).toBe('loading');
    expect(state(undefined, transient, 0, 5)).toBe('loading');
    expect(state(undefined, missing, 0, 5)).toBe('unavailable');
    expect(state(undefined, internal, 0, 5)).toBe('unavailable');
    expect(state(TO_CUSTOMER, transient, 10, 20)).toBe('ready');
    expect(state(TO_CUSTOMER, missing, 10, 20)).toBe('unavailable');
    expect(state(TO_CUSTOMER, missing, 30, 20)).toBe('ready');
  });

  it('yoklama yokken (\'once\') gecici hata da "alinamadi" ve "Tekrar dene" (takili kalmaz)', () => {
    const transient = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');

    expect(
      courierMapState({
        data: undefined,
        error: transient,
        dataUpdatedAt: 0,
        errorUpdatedAt: 5,
        polling: false,
      }).kind,
    ).toBe('unavailable');
    expect(
      courierMapState({
        data: TO_CUSTOMER,
        error: transient,
        dataUpdatedAt: 10,
        errorUpdatedAt: 20,
        polling: false,
      }).kind,
    ).toBe('unavailable');
  });

  it('bildirim gosterildiyse kapali pencerede izleme durur (N4); pencere acikken surer', () => {
    expect(trackingMode(false, 'ON_THE_WAY', true)).toBe('off');
    expect(trackingMode(false, 'ON_THE_WAY', false)).toBe('watch');
    expect(trackingMode(true, 'ON_THE_WAY', true)).toBe('open');
  });
});

describe('bildirim ve pencere kurallari (F22 QA K9: B1, B3, N1)', () => {
  it('fare YA DA odak bildirimdeyken sure durur; biri cikinca digeri surerken baslamaz (N1)', () => {
    expect([
      noticePaused(false, false),
      noticePaused(true, false),
      noticePaused(false, true),
      noticePaused(true, true),
    ]).toEqual([false, true, true, true]);
  });

  it('kapaninca odak yalniz icindeyse ve sayfaya dustuyse tasinir; etkilesmemis kullanici kipirdamaz (B1)', () => {
    const base = { closed: true, focusWasInside: true, activeIsPage: true, targetAvailable: true };

    expect(focusAfterClose(base)).toBe('target');
    expect(focusAfterClose({ ...base, focusWasInside: false })).toBe('none');
    expect(focusAfterClose({ ...base, activeIsPage: false })).toBe('none');
    expect(focusAfterClose({ ...base, closed: false })).toBe('none');
  });

  it('"Kuryem nerede" yok olduysa (teslimde) odak takip kartinin basligina (B3)', () => {
    expect(
      focusAfterClose({
        closed: true,
        focusWasInside: true,
        activeIsPage: true,
        targetAvailable: false,
      }),
    ).toBe('fallback');
  });

  it('pencere acilinca suren istege katilir; son duruma gecince TAZE istek (B3; eski cevap son durum sanilmaz)', () => {
    expect(refetchOnModeChange('watch', 'open')).toBe('join');
    expect(refetchOnModeChange('off', 'open')).toBe('join');
    expect(refetchOnModeChange('open', 'once')).toBe('fresh');
    expect(refetchOnModeChange('open', 'open')).toBe('none');
    expect(refetchOnModeChange('open', 'watch')).toBe('none');
    expect(refetchOnModeChange('watch', 'off')).toBe('none');
  });
});

describe('takip sorgusu (QueryObserver, sahte saat)', () => {
  // Node'da pencere yok: TanStack ortami sunucu sayar ve zamanlayici kurmaz.
  const server = environmentManager.isServer();
  beforeEach(() => environmentManager.setIsServer(() => false));
  afterEach(() => {
    environmentManager.setIsServer(() => server);
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function observe(mode: TrackingMode, reply: () => Response) {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(reply()));
    const http = createHttpClient({ baseUrl: '', fetch: fetchMock });
    const client = createQueryClient();
    const observer = new QueryObserver(client, orderTrackingQuery(http, USER, TRACKED_ORDER, mode));
    const unsubscribe = observer.subscribe(() => undefined);
    return { fetchMock, stop: () => (unsubscribe(), client.clear()) };
  }
  const ok = (data: OrderTracking) => () => new Response(JSON.stringify({ success: true, data }));

  it("pencere acikken 2 sn'de bir; dogru uc", async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('open', ok(TO_CUSTOMER));

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(TRACKING_POLL_OPEN_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(typeof input === 'string' ? input : '').toBe(`/v1/orders/${TRACKED_ORDER}/tracking`);
    stop();
  });

  it("kapali, kurye yolda: 10 sn'de bir (yaklasma icin)", async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('watch', ok(TO_CUSTOMER));

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(TRACKING_POLL_OPEN_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TRACKING_POLL_WATCH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('kapali (kurye yolda degil): hic istek yok', async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('off', ok(TO_CUSTOMER));

    await vi.advanceTimersByTimeAsync(TRACKING_POLL_WATCH_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it('teslim edildi ya da takip yok (404): yoklama durur, 404 yeniden denenmez', async () => {
    vi.useFakeTimers();
    for (const reply of [
      ok(DELIVERED),
      () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' },
          }),
          { status: 404 },
        ),
    ]) {
      const { fetchMock, stop } = observe('open', reply);

      await vi.advanceTimersByTimeAsync(TRACKING_POLL_OPEN_MS * 5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it('sekme gizliyken durur', async () => {
    vi.useFakeTimers();
    const { fetchMock, stop } = observe('open', ok(TO_CUSTOMER));

    await vi.advanceTimersByTimeAsync(100);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(TRACKING_POLL_OPEN_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('yaklasma bildirimi bir kez (F22, PM S3 a)', () => {
  afterEach(() => {
    resetApproachMemory();
    vi.unstubAllGlobals();
  });

  it('karar: yaklasti ve gosterilmediyse goster; harita aciksa yalniz isaretle', () => {
    expect(approachDecision(true, false, false)).toBe('show');
    expect(approachDecision(true, false, true)).toBe('mark');
    expect(approachDecision(true, true, false)).toBe('none');
    expect(approachDecision(false, false, false)).toBe('none');
    // Metinler hazir degilse karar beklenir: isaretlenmez, bildirim gorulmeden kaybolmaz.
    expect(approachDecision(true, false, false, false)).toBe('none');
    expect(APPROACH_NOTICE_MS).toBe(15_000);
  });

  it('depoya YALNIZ siparis kimligi bayragi yazilir (konum ve kurye yok; QA K9)', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    expect(approachNotified(TRACKED_ORDER)).toBe(false);
    markApproachNotified(TRACKED_ORDER);
    expect([...store.entries()]).toEqual([[`getir.courier-approach.${TRACKED_ORDER}`, '1']]);
    resetApproachMemory();
    expect(approachNotified(TRACKED_ORDER)).toBe(true);
  });

  it('depo yoksa (ozel mod) bellek yeter: ayni sekmede ikinci kez cikmaz', () => {
    expect(approachNotified(TRACKED_ORDER)).toBe(false);
    markApproachNotified(TRACKED_ORDER);
    expect(approachNotified(TRACKED_ORDER)).toBe(true);
  });
});
