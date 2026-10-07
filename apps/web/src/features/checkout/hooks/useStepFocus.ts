import { useEffect, useRef } from 'react';

/**
 * Adim acilinca odak (T17.1; F5, P4): adimin kokunde ilk eslesen ogeye;
 * bulunmazsa yedek secime. Adimlar ayni pencerede degisir: onceki adimin
 * odakli ogesi kalkinca odak kaybolmasin.
 */
export function useStepFocus<T extends HTMLElement>(selector: string, fallback: string) {
  const root = useRef<T>(null);
  useEffect(() => {
    const element = root.current;
    const target =
      element?.querySelector<HTMLElement>(selector) ??
      element?.querySelector<HTMLElement>(fallback);
    target?.focus();
  }, [selector, fallback]);
  return root;
}
