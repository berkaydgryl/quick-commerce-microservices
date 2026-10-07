import type { SavedCard } from '@getir/contracts';

/**
 * Odemede secili gelen kart (T17.1; PM karari M4): suresi gecmemis EN YENI
 * kart. "Varsayilan kart" alani yok; liste yeniden eskiye sirali gelir ama
 * sira burada da createdAt'ten kurulur (sunucu sirasina yaslanilmaz). Suresi
 * gecmis kart odemede kullanilamaz (cards.ts); hic gecerli kart yoksa undefined.
 */
export function defaultCard(cards: readonly SavedCard[]): SavedCard | undefined {
  return cards
    .filter((card) => !card.expired)
    .reduce<SavedCard | undefined>(
      (newest, card) => (newest === undefined || card.createdAt > newest.createdAt ? card : newest),
      undefined,
    );
}

/**
 * Odemede kullanilacak kart (T17.1; F5, P2): secilen kart (chosenId) hala
 * listede ve suresi gecmemisse o; degilse (hic secilmedi, silindi, suresi
 * doldu) kural defaultCard'a doner. Pencerenin bekleyen secimi de ayni
 * kuralla gorunur: secili kart silinince kalan en yeni gecerli kart secilir.
 */
export function effectiveCard(
  cards: readonly SavedCard[],
  chosenId: string | undefined,
): SavedCard | undefined {
  return cards.find((card) => card.id === chosenId && !card.expired) ?? defaultCard(cards);
}
