import type { CheckoutContent } from '@getir/contracts';

/** Cok fazla hatali kod (429; F15b, #163): cumle, geri sayimin basi ve kalan saniye. */
export interface RetryWait {
  readonly notice: string;
  readonly label: string;
  readonly seconds: number;
}

export interface PlaceHints {
  /** Ilk eksik kosulun cumlesi (N1). */
  readonly blocker: string | undefined;
  /** 429 beklemesi; varken eksik kosul yazilmaz. */
  readonly wait: RetryWait | undefined;
}

/**
 * "Sipariş Ver"in altindaki satir (F15b). Akis bosta degilken (siparis ucusta,
 * 3DS ya da yenilemede surdurme) satir YOK: dugme "Sipariş veriliyor…" der,
 * eksik kosul cumlesi onunla celisirdi (PM). Bostayken once 429 beklemesi
 * ("Çok fazla hatalı kod girdin. Yeniden deneyebilmen için 2:05"), sonra ilk
 * eksik kosul. Kapida odemede 429 beklemesi yazilmaz.
 */
export function placeHints(
  flow: {
    readonly idle: boolean;
    /** Kartla mi odenecek: 429 kapisi yalniz kartli siparisi durdurur (kapida odeme serbest). */
    readonly byCard: boolean;
    readonly waitSeconds: number;
  },
  blocker: string | undefined,
  texts: Pick<CheckoutContent, 'threeDsRateLimitedNotice' | 'retryWaitLabel'>,
): PlaceHints {
  const { idle, byCard, waitSeconds } = flow;
  if (!idle) {
    return { blocker: undefined, wait: undefined };
  }
  if (byCard && waitSeconds > 0) {
    const wait = {
      notice: texts.threeDsRateLimitedNotice,
      label: texts.retryWaitLabel,
      seconds: waitSeconds,
    };
    return { blocker: undefined, wait };
  }
  return { blocker, wait: undefined };
}
