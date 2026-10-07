/**
 * Baska market penceresi kapaninca odak (T16.3 duzeltmesi). Pencere acilmadan
 * once odakli dugme ("+") ve durdugu yer yakalanir:
 *   - Hayır, Esc, karartma: "+" hala sayfada; odak ona doner;
 *   - Evet: urun eklendi, "+" adet kutusuna donustu; ayni yerdeki kutunun
 *     "adedini artır" dugmesine (o pasifse kutudaki ilk etkin dugmeye).
 * Odakli oge dugme degilse (fareyle tiklamada odak vermeyen tarayici) bir sey
 * yapilmaz: odak sayfada rastgele bir yere atlamasin.
 */
export function captureSwitchFocus(increaseLabel: string): () => void {
  if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLButtonElement)) {
    return () => undefined;
  }
  const opener = document.activeElement;
  const slot = opener.parentElement;
  return () => {
    if (opener.isConnected) {
      opener.focus();
      return;
    }
    if (slot === null || !slot.isConnected) {
      return;
    }
    const buttons = [...slot.querySelectorAll('button')].filter((button) => !button.disabled);
    (
      buttons.find((button) => button.getAttribute('aria-label') === increaseLabel) ?? buttons[0]
    )?.focus();
  };
}
