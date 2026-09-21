/**
 * Hata kodu -> kullaniciya gosterilecek Turkce mesaj sozlugu.
 *
 * GOREV DAGILIMI: kodun KENDISI ve protokol karsiliklari (HTTP durumu, gRPC
 * status) @getir/core icindeki ERROR_CODES'a aittir; bu dosya yalnizca o
 * kodlarin insan diline cevirisini tutar. Kodlar burada TEKRAR TANIMLANMAZ.
 *
 * Sozluk Record<ErrorCode, string> olarak yazildigi icin eksiksiz olmak
 * ZORUNDADIR: core'a yeni bir hata kodu eklendiginde bu dosya derlenmez ve
 * eksik ceviri daha ilk tip kontrolunde yakalanir. Bu davranis bilerek
 * secilmistir; varsayilan bir "Bir hata olustu" metnine dusmek, eksikligi
 * kullanici ekraninda gorene kadar gizlerdi.
 *
 * USLUP: mesajlar kullaniciya ne oldugunu ve mumkunse ne yapmasi gerektigini
 * soyler. Teknik terim, hata kodu ve yigin izi gecmez; onlar gelistirici icin
 * ApiError.code ve loglardadir.
 */

import { ERROR_CODES, type ErrorCode } from '@getir/core';

import type { ApiError } from './envelope.js';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.VALIDATION_FAILED]: 'Girdiğin bilgilerde bir sorun var, kontrol eder misin?',
  [ERROR_CODES.UNAUTHORIZED]: 'Oturumun sona ermiş. Tekrar giriş yapman gerekiyor.',
  [ERROR_CODES.FORBIDDEN]: 'Bu işlem için yetkin yok.',
  [ERROR_CODES.NOT_FOUND]: 'Aradığın kaydı bulamadık.',
  [ERROR_CODES.CONFLICT]: 'Bu kayıt az önce değişti. Sayfayı yenileyip tekrar dener misin?',
  [ERROR_CODES.INTERNAL]: 'Beklenmeyen bir sorun oldu. Birazdan tekrar dene.',
  [ERROR_CODES.STOCK_INSUFFICIENT]: 'Bu üründen yeterli stok kalmadı.',
  [ERROR_CODES.RESERVATION_EXPIRED]: 'Süre doldu, sepetini yenileyelim.',
  [ERROR_CODES.RESERVATION_ACTIVE]:
    'Devam eden bir siparişin var. Önce onu tamamla ya da iptal et.',
  [ERROR_CODES.RISK_BLOCKED]:
    'Bu siparişi şu an tamamlayamıyoruz. Destek ekibimizle görüşebilirsin.',
  [ERROR_CODES.RISK_REVIEW]: 'Siparişin kontrol ediliyor. Sonucu birazdan bildireceğiz.',
  [ERROR_CODES.PAYMENT_DECLINED]: 'Ödeme alınamadı. Başka bir kart deneyebilirsin.',
  [ERROR_CODES.THREEDS_REQUIRED]: 'Ödemeyi tamamlamak için doğrulama kodunu girmen gerekiyor.',
  [ERROR_CODES.THREEDS_FAILED]: 'Doğrulama kodu geçersiz. Tekrar dener misin?',
  [ERROR_CODES.PRICE_CHANGED]: 'Sepetindeki fiyatlar güncellendi. Yeni tutarı onaylar mısın?',
  [ERROR_CODES.COUPON_INVALID]: 'Bu kupon kullanılamıyor.',
  [ERROR_CODES.MIN_BASKET_NOT_MET]: 'Minimum sepet tutarına ulaşmadın.',
  [ERROR_CODES.NO_STORE]: 'Bu adrese şu anda teslimat yapamıyoruz.',
  [ERROR_CODES.REQUEST_IN_PROGRESS]: 'İşlemin sürüyor, biraz bekler misin?',
  [ERROR_CODES.RATE_LIMITED]: 'Çok fazla deneme yaptın. Kısa bir süre sonra tekrar dene.',
  [ERROR_CODES.ORDER_STATE_INVALID]: 'Siparişin bu adımda bu işlemi yapmaya uygun değil.',
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 'Servise şu an ulaşamıyoruz. Birazdan tekrar dene.',
};

/** Kodun kullaniciya gosterilecek karsiligini dondurur. */
export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

/**
 * Koddan hata govdesi uretir; mesaj sozlukten otomatik gelir.
 *
 * Mesaji cagiran tarafin yazmasina bilerek izin verilmiyor: ayni kod iki ayri
 * uctan iki farkli metinle donerse kullanici acisindan tutarsiz bir urun cikar.
 */
export function toApiError(
  code: ErrorCode,
  requestId: string,
  details?: Record<string, unknown> | null,
): ApiError {
  return details === undefined
    ? { code, message: errorMessage(code), requestId }
    : { code, message: errorMessage(code), details, requestId };
}
