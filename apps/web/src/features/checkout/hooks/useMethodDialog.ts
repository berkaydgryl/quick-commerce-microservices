import { useEffect, useRef, useState } from 'react';

import type { MethodDialogStart } from '../services/method-dialog';

/**
 * "Ödeme Yöntemi Seç" penceresinin acik/kapali durumu (T17.1; F5). Pencere
 * kapaninca odak sayfadaki dugmeye doner (P4): "Değiştir"; kart yokken
 * "Seç" (secim yapildiysa artik "Değiştir" vardir, ayni ref).
 */
export function useMethodDialog() {
  const [start, setStart] = useState<MethodDialogStart | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (start === null && wasOpen.current) {
      actionRef.current?.focus();
    }
    wasOpen.current = start !== null;
  }, [start]);

  return { start, open: setStart, close: () => setStart(null), actionRef };
}
