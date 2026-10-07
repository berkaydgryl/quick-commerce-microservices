/**
 * Cekimin kart kaynagi (T12.4; B1): kasadaki kart (card_id) ya da eski test
 * jetonu (card_token, DEPRECATED; kaldirma bekleyen is 118).
 *
 * Kayitli kart, cekim kaydi yazilmadan ONCE cozulur (application/charge.ts):
 * kart yoksa, silinmisse ya da baskasininsa NOT_FOUND (ayrinti resource "card",
 * kimlik yankilanmaz) ve HICBIR kayit yazilmaz; idempotency anahtari harcanmaz,
 * ayni siparis baska kartla yeniden cekilebilir.
 *
 * Sahiplik: kart, cagrinin dogrulanmis kullanicisiyla (ChargeRequest.user_id;
 * order onu gateway'in dogruladigi oturumdan alir) aranir; istekteki baska bir
 * kimlik aramaya girmez.
 *
 * Saglayici jetonu YALNIZCA bellekte tasinir: cevaba, gunluge ve odeme kaydina
 * girmez; kayda yalnizca kartin kimligi yazilir.
 */

import { paymentCardNotFound } from '../domain/card-errors.js';
import type { CardRepository } from '../domain/card-repository.js';

/** Kart kaynagi; kapida odemede yok. */
export type CardSource = { readonly cardId: string } | { readonly cardToken: string };

/** Saglayiciya gidecek jeton ve (kayitli kartta) kayda yazilacak kimlik. */
export interface ResolvedCard {
  readonly providerToken: string;
  readonly cardId?: string;
}

export interface ChargeCardDeps {
  readonly cards: Pick<CardRepository, 'findActive'>;
}

/**
 * @throws AppError NOT_FOUND (resource "card") - kayitli kart kasada yok.
 */
export async function resolveChargeCard(
  deps: ChargeCardDeps,
  userId: string,
  source: CardSource,
): Promise<ResolvedCard> {
  if ('cardToken' in source) {
    return { providerToken: source.cardToken };
  }
  const card = await deps.cards.findActive(userId, source.cardId);
  if (card?.providerToken === undefined) {
    throw paymentCardNotFound();
  }
  return { providerToken: card.providerToken, cardId: card.id };
}

/**
 * Saglayici hatasinin jetonsuz kopyasi (gunluk icin): mesaj ve yigindaki jeton
 * gecisleri maskelenir. Hata nesnesi degilse oldugu gibi doner.
 */
export function withoutProviderToken(error: unknown, providerToken: string): unknown {
  if (providerToken === '') {
    return error;
  }
  const scrub = (text: string): string => text.split(providerToken).join('[jeton]');
  if (typeof error === 'string') {
    return scrub(error);
  }
  if (!(error instanceof Error)) {
    return error;
  }
  const copy = new Error(scrub(error.message));
  copy.name = error.name;
  if (error.stack !== undefined) {
    copy.stack = scrub(error.stack);
  }
  return copy;
}
