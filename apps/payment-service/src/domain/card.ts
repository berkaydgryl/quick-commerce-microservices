/**
 * Kart kasasinin VARLIGI (T11.17): kullanicinin kayitli karti, MASKELI.
 *
 * Tam kart numarasi ve CVV bu tipte YOKTUR. Numara yalnizca ekleme aninda
 * use-case'in elinden gecer: maskelenir (ilk 4, son 4), saglayiciya
 * dogrulatilir ve birakilir. Kalan: marka, son kullanma, ad, kart adi ve
 * saglayicinin jetonu (kayitli kartla odeme T12.4'te; hicbir cevaba CIKMAZ).
 *
 * KURAL: bu dosya DISARI BAKMAZ - grpc, uretilen proto tipi ya da veritabani
 * importu yoktur. Kart kurallari (Luhn, marka, son kullanma) @getir/contracts
 * cards.ts'tedir: web ile kasa ayni fonksiyonlari kullanir.
 */

import type { CardBrand } from '@getir/contracts';

export const CARD_STATUS = {
  ACTIVE: 'ACTIVE',
  /** Yumusak silme: listede gorunmez, saglayici jetonu silinmistir. */
  DELETED: 'DELETED',
} as const;

export type CardStatus = (typeof CARD_STATUS)[keyof typeof CARD_STATUS];

/** Numaranin maskede kalan parcasi: ilk ve son kac hane. */
const MASK_DIGITS = 4;

export interface Card {
  /** crd_ + 32 onaltilik; rastgele, numaradan TURETILMEZ. */
  readonly id: string;
  readonly userId: string;
  readonly brand: CardBrand;
  readonly first4: string;
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly holderName: string;
  /** Kullanicinin karta verdigi ad; verilmediyse alan yok. */
  readonly nickname?: string;
  /** Saglayicinin kart jetonu: yalnizca ACTIVE kartta dolu, silmede silinir. */
  readonly providerToken?: string;
  readonly status: CardStatus;
  readonly createdAt: Date;
  /** Yalnizca DELETED kartta dolu. */
  readonly deletedAt?: Date;
}

/**
 * AYNI KART anahtari: kullanicinin kasasinda ilk 4 + son 4 hane + son
 * kullanma. Tam numara saklanmadigi icin bu anahtari paylasan iki farkli kart
 * (nadir) ayni sayilir; numaranin HMAC'i bilerek tutulmaz (D1).
 */
export interface CardKey {
  readonly userId: string;
  readonly first4: string;
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
}

/** Numaranin maskesi: ilk 4 ve son 4 hane (numara yalnizca rakamlar). */
export function maskCardNumber(digits: string): {
  readonly first4: string;
  readonly last4: string;
} {
  return { first4: digits.slice(0, MASK_DIGITS), last4: digits.slice(-MASK_DIGITS) };
}

export function cardKeyOf(card: CardKey): CardKey {
  return {
    userId: card.userId,
    first4: card.first4,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
  };
}

export function isSameCard(left: CardKey, right: CardKey): boolean {
  return (
    left.userId === right.userId &&
    left.first4 === right.first4 &&
    left.last4 === right.last4 &&
    left.expiryMonth === right.expiryMonth &&
    left.expiryYear === right.expiryYear
  );
}

/**
 * Silinmis kart: DELETED, silme ani; saglayici jetonu kayitta KALMAZ. Kayitli
 * kartla odeme (T12.4) kart kimligi ve ACTIVE durumuyla yapilir, ham jetonla
 * degil; silinen karta bu yoldan odeme yapilamaz. Jetonun kendisi saglayicida
 * hala gecerlidir: gercek saglayicida silmede iptal edilmeli (bekleyen is #103).
 */
export function deletedCard(card: Card, at: Date): Card {
  const { providerToken: _providerToken, ...rest } = card;
  return { ...rest, status: CARD_STATUS.DELETED, deletedAt: at };
}

/**
 * Ad kaldirma mi (#148): null ya da bos metin. "Ad yok" HER ZAMAN alan yok
 * demektir; depo bos metin yazmaz.
 */
export function isNicknameRemoval(nickname: string | null): nickname is null | '' {
  return nickname === null || nickname === '';
}

/** Adi degistirilmis kart (#148): null ya da bos metin ad alanini KALDIRIR. */
export function renamedCard(card: Card, nickname: string | null): Card {
  const { nickname: _previous, ...rest } = card;
  return isNicknameRemoval(nickname) ? rest : { ...rest, nickname };
}
