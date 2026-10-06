/**
 * Kart kasasi uclari (T11.17): GET /v1/me/cards, POST /v1/me/cards, DELETE
 * /v1/me/cards/{cardId}. Korumali: yetkili istemciyle cagrilir; cevaplar
 * MASKELIDIR (ilk 4 + son 4 hane) ve sozlesmeyle dogrulanir.
 *
 * KART NUMARASI VE CVV yalnizca ekleme isteginin govdesinde bir kez gider
 * (M7): sorgu onbellegine, tarayici deposuna, adrese ve Idempotency-Key'e
 * girmez.
 */

import { savedCardListSchema, savedCardSchema } from '@getir/contracts';
import type { AddCardRequest, SavedCard, SavedCardList } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** Kullanicinin kayitli kartlari, yeniden eskiye; karti yoksa bos liste. */
export function fetchSavedCards(client: HttpClient, signal?: AbortSignal): Promise<SavedCardList> {
  return client.request('/v1/me/cards', { schema: savedCardListSchema, signal });
}

/**
 * Kart ekler; cevap eklenen kartin maskeli hali. Kalici kayit: anahtar ister
 * (ADR-08). Kural ihlali VALIDATION_FAILED (alan -> cumle, deger yankilanmaz),
 * ayni kart CONFLICT, saglayici reddi PAYMENT_DECLINED, dolu kasa
 * VALIDATION_FAILED (cards).
 */
export function addCard(
  client: HttpClient,
  request: AddCardRequest,
  idempotencyKey: string,
): Promise<SavedCard> {
  return client.request('/v1/me/cards', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: savedCardSchema,
  });
}

/** Karti siler; govdesiz, cevap guncel liste. Kart yoksa (ya da baskasinin) NOT_FOUND. */
export function deleteCard(
  client: HttpClient,
  cardId: string,
  idempotencyKey: string,
): Promise<SavedCardList> {
  return client.request(`/v1/me/cards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
    idempotencyKey,
    schema: savedCardListSchema,
  });
}
