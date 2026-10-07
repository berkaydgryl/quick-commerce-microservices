/**
 * Kart kasasi (T11.17): GET /v1/me/cards, POST /v1/me/cards, PATCH
 * /v1/me/cards/{cardId} (kart adi, #148), DELETE /v1/me/cards/{cardId}. Kasa
 * payment-svc'dedir (getir/cardvault/v1); gateway istegi iletir.
 *
 * KART NUMARASI VE CVV yalnizca ekleme isteginde ve bir kez gecer; saklanmaz,
 * gunluge ve ize yazilmaz. Cevaplar MASKELIDIR: ilk 4 ve son 4 hane, marka, son
 * kullanma, ad, kart adi ve kimlik.
 *
 * Bu dosya istek ve cevap SEMALARIDIR; kurallar ve alan cumleleri
 * card-rules.ts'tedir (semalar onlari kullanir, cumle yazmaz).
 */

import { z } from 'zod';

import {
  CARD_FIELD_MESSAGES,
  cardBrandOf,
  cardBrandSchema,
  cardHolderNameProblem,
  cardNicknameProblem,
  cardNumberProblem,
  cvvLengthOf,
  normalizeCardNumber,
  normalizeCardText,
} from './card-rules.js';
import { cardIdSchema, isoDateTimeSchema } from './common.js';
import {
  CARD_HOLDER_NAME_MAX_LENGTH,
  CARD_NICKNAME_MAX_LENGTH,
  SAVED_CARDS_MAX,
} from './constants.js';

/** Saf kural fonksiyonunun cumlesini (varsa) alana yazar. */
function addProblem(context: z.RefinementCtx, problem: string | null): void {
  if (problem !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }
}

/**
 * Kart adi kurallari (ekleme ve duzenleme AYNI): NFC'ye cevrilir ve kirpilir,
 * cardNicknameProblem'den gecer. Bos ya da yalnizca bosluk kart adi "kart adi
 * yok"tur: cikista undefined (QA S4; proto'daki bos metin de ayni anlam).
 * Iki alan yalnizca tur hatasinin cumlesinde ayrilir.
 */
function withNicknameRules(text: z.ZodString) {
  return text
    .transform(normalizeCardText)
    .superRefine((value, context) => addProblem(context, cardNicknameProblem(value)))
    .transform((value) => (value === '' ? undefined : value));
}

/** Eklemede istege bagli kart adi: metin olmayan deger uzunluk cumlesini alir. */
const addNicknameSchema = withNicknameRules(
  z.string({ invalid_type_error: CARD_FIELD_MESSAGES.nickname }),
);

/**
 * Duzenlemede ZORUNLU kart adi: alan yoksa ya da null ise "Kart adı
 * gönderilmedi" (null adi KALDIRMAZ; kaldirmak bos metindir). Gateway JSON
 * null'u da eksik alan olarak iletir (proto optional), cumle ayni kalir.
 */
const updateNicknameSchema = withNicknameRules(
  z.string({
    errorMap: (issue) => ({
      message:
        issue.code === z.ZodIssueCode.invalid_type &&
        (issue.received === z.ZodParsedType.undefined || issue.received === z.ZodParsedType.null)
          ? CARD_FIELD_MESSAGES.nicknameMissing
          : CARD_FIELD_MESSAGES.nickname,
    }),
  }),
);

/**
 * POST /v1/me/cards: kart ekleme. Kalici kayit: Idempotency-Key ister
 * (ADR-08). Cevap 201 ve eklenen kart (savedCardSchema).
 *
 * Semanin denetledigi: bicim, Luhn, marka, ay 1-12, dort haneli yil, markaya
 * gore CVV uzunlugu, ad ve kart adi (ikisi NFC ve kirpilmis; bos kart adi
 * cikista yok). Kasanin ayrica denetledigi (zamana ve kayda bagli): son kullanma
 * gecmemis ve en fazla CARD_EXPIRY_MAX_YEARS_AHEAD yil ileri; kart siniri
 * (SAVED_CARDS_MAX); kullanicinin kasasinda ayni kart (CONFLICT); saglayicinin
 * 0 TL dogrulamasi (PAYMENT_DECLINED).
 */
export const addCardRequestSchema = z
  .object({
    number: z
      .string({
        required_error: CARD_FIELD_MESSAGES.number,
        invalid_type_error: CARD_FIELD_MESSAGES.number,
      })
      .superRefine((value, context) => addProblem(context, cardNumberProblem(value))),
    expiryMonth: z
      .number({
        required_error: CARD_FIELD_MESSAGES.expiryMonth,
        invalid_type_error: CARD_FIELD_MESSAGES.expiryMonth,
      })
      .int(CARD_FIELD_MESSAGES.expiryMonth)
      .min(1, CARD_FIELD_MESSAGES.expiryMonth)
      .max(12, CARD_FIELD_MESSAGES.expiryMonth),
    expiryYear: z
      .number({
        required_error: CARD_FIELD_MESSAGES.expiryYear,
        invalid_type_error: CARD_FIELD_MESSAGES.expiryYear,
      })
      .int(CARD_FIELD_MESSAGES.expiryYear)
      .min(2000, CARD_FIELD_MESSAGES.expiryYear)
      .max(2099, CARD_FIELD_MESSAGES.expiryYear),
    cvv: z
      .string({
        required_error: CARD_FIELD_MESSAGES.cvv,
        invalid_type_error: CARD_FIELD_MESSAGES.cvv,
      })
      .regex(/^\d{3,4}$/, CARD_FIELD_MESSAGES.cvv),
    holderName: z
      .string({
        required_error: CARD_FIELD_MESSAGES.holderName,
        invalid_type_error: CARD_FIELD_MESSAGES.holderName,
      })
      .transform(normalizeCardText)
      .superRefine((value, context) => addProblem(context, cardHolderNameProblem(value))),
    nickname: addNicknameSchema.optional(),
  })
  .superRefine(({ number, cvv }, context) => {
    // Yalnizca numara ve CVV bicimi gecerliyken: ayni alana ikinci cumle yazilmaz.
    if (cardNumberProblem(number) !== null || !/^\d{3,4}$/.test(cvv)) {
      return;
    }
    const brand = cardBrandOf(normalizeCardNumber(number));
    if (brand !== null && cvv.length !== cvvLengthOf(brand)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cvv'],
        message: CARD_FIELD_MESSAGES.cvv,
      });
    }
  });

/**
 * PATCH /v1/me/cards/{cardId} (#148): YALNIZCA kart adi degisir; numara, son
 * kullanma ve CVV degismez (yeni kart icin sil + ekle). Kalici kayit:
 * Idempotency-Key ister (ADR-08). Cevap 200 ve guncel kart (savedCardSchema).
 *
 * `nickname` ZORUNLU: bos ya da yalnizca bosluk adi KALDIRIR (cikista
 * undefined); alan yoksa ya da null ise "Kart adı gönderilmedi" (bos govde adi
 * silmesin). Kurallar eklemedekiyle ayni. SIKI sema: bilinmeyen alan (numara,
 * CVV, son kullanma) reddedilir; gateway de 400 doner. Kasa (payment) bu
 * semayi kullanicinin ve kartin kimligiyle genisletir; proto alani optional
 * oldugu icin eksik alan kasaya kadar eksik gider. Kasanin denetledigi: kart bu
 * kullanicinin ve silinmemis (yoksa NOT_FOUND; uc durum ayirt edilemez).
 * Suresi gecmis kartin adi da degisebilir.
 */
export const updateCardNicknameRequestSchema = z
  .object({
    nickname: updateNicknameSchema,
  })
  .strict();

/**
 * Kayitli kart: MASKELI gorunum (proto SavedCard). Tam numara ve CVV yoktur.
 * `expired`: son kullanma ayi gecti mi (okuma anina gore); suresi gecen kart
 * listede kalir, odemede kullanilamaz (T12.4).
 */
export const savedCardSchema = z.object({
  /** crd_ + 32 onaltilik: silmede, kart adi duzenlemede (#148) ve (T12.4) odemede tasinir. */
  id: cardIdSchema,
  brand: cardBrandSchema,
  first4: z.string().regex(/^\d{4}$/),
  last4: z.string().regex(/^\d{4}$/),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2000).max(2099),
  holderName: z.string().min(1).max(CARD_HOLDER_NAME_MAX_LENGTH),
  /** Kullanicinin verdigi ad; verilmediyse alan yok. */
  nickname: z.string().min(1).max(CARD_NICKNAME_MAX_LENGTH).optional(),
  expired: z.boolean(),
  createdAt: isoDateTimeSchema,
});

/**
 * GET /v1/me/cards ve DELETE /v1/me/cards/{cardId} cevabi: silinmemis kartlar,
 * yeniden eskiye. Sayfasiz SINIRLI liste (en fazla SAVED_CARDS_MAX); karti
 * olmayan hesapta bos liste.
 */
export const savedCardListSchema = z.object({
  items: z.array(savedCardSchema).max(SAVED_CARDS_MAX),
});

export type AddCardRequest = z.infer<typeof addCardRequestSchema>;
/** Istemcinin gonderdigi govde: kart adi METIN, bos metin adi kaldirir. */
export type UpdateCardNicknameRequest = z.input<typeof updateCardNicknameRequestSchema>;
export type SavedCard = z.infer<typeof savedCardSchema>;
export type SavedCardList = z.infer<typeof savedCardListSchema>;
