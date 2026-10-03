import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dugmeyle acilan liste (T11.10: ust bardaki adres listesi ve Profil menusu).
 * Erisilebilir "acilir icerik" deseni: dugme aria-expanded + aria-controls,
 * liste DOM'da kalir (hidden). Kapanma yollari:
 *
 *  - Esc (belgenin her yerinde): fareyle acan kullanicinin odagi dugmede
 *    olmayabilir. Odak yalnizca listedeyse ya da hicbir yerde degilse dugmeye
 *    doner; baska bir kutudaki Esc'in odagi calinmaz.
 *  - Disari tiklama: liste baska bir ogenin ustunde acik kalmaz.
 *  - close(): secim yapilinca; odak dugmeye doner (gizlenen listede kaybolmaz).
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      const active = document.activeElement;
      const focusWasHere =
        active === null || active === document.body || rootRef.current?.contains(active) === true;
      setOpen(false);
      if (focusWasHere) {
        toggleRef.current?.focus();
      }
    };
    const closeOnOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutside);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  return { open, toggle, close, rootRef, toggleRef };
}
