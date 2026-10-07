/** Sepet sayfasinin adresi (T16.3): Sepetim paneli ve sepet cubugunun "Sepete git"i buraya gider. */
export const CART_PATH = '/sepet';

/** "Sepete git"in hedefi: sepet tek markettir, sayfa marketi sepetten okur. */
export function cartPath(): string {
  return CART_PATH;
}
