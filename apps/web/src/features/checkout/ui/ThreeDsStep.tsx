import { useEffect, useRef } from 'react';

import { useCountdown } from '../hooks/useCountdown';

import { ThreeDsDialog } from './ThreeDsDialog';
import type { ThreeDsTexts } from './ThreeDsDialog';

interface ThreeDsStepProps {
  /** Son an; sunucu sure bildirmediyse undefined (geri sayim yok). */
  readonly deadline: number | undefined;
  readonly verifying: boolean;
  readonly failure: { readonly message: string; readonly attemptsLeft: number } | undefined;
  /** Yenilemede surdurulen 3DS'te sunucunun kalan hakki (F15b). */
  readonly attemptsLeft?: number | undefined;
  /** Cok fazla hatali kod (429; F15b): tekrar denemeye kalan saniye. */
  readonly waitSeconds?: number | undefined;
  readonly texts: ThreeDsTexts;
  readonly onSubmit: (otp: string) => void;
  readonly onCancel: () => void;
  /** Sure doldu: bir kez cagrilir (rezervasyon birakilir, bildirim). */
  readonly onExpire: () => void;
  /** Saat (test); varsayilan monotonik saat. */
  readonly now?: (() => number) | undefined;
}

/** 3DS adimi: geri sayimi isletir ve sure dolunca bir kez bildirir; gorunum ThreeDsDialog. */
export function ThreeDsStep({ deadline, now, onExpire, ...dialog }: ThreeDsStepProps) {
  const remaining = useCountdown(deadline, now);
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);
  useEffect(() => {
    if (remaining === 0 && !expired.current) {
      expired.current = true;
      onExpireRef.current();
    }
  }, [remaining]);
  return <ThreeDsDialog remaining={remaining} {...dialog} />;
}
