/**
 * Gunlukcu ARAYUZU (uygulamasi degil).
 *
 * NEDEN CORE'DA: mongo-kit, redis-kit ve service-kit'in ucu de "bana bir
 * gunlukcu ver" demek zorunda. Arayuz service-kit'te kalsaydi, veri katmani
 * paketleri gRPC paketine bagimli olurdu - yanlis yon. Burada yalnizca TIP ve
 * hicbir sey yazmayan bir uygulama durur; gercek gunlukcu (pino) service-kit
 * icindedir ve ileride packages/observability'ye tasinacaktir.
 *
 * Bu dosya core'un kuralini bozmaz: bagimlilik yok, I/O yok.
 */

/** Gunluk kaydina eklenen yapilandirilmis baglam alanlari. */
export type LogFields = Record<string, unknown>;

/**
 * Kod tabaninin gordugu gunlukcu yuzeyi.
 * Baglam alanlari mesajdan ONCE gelir: logger.info({ orderId }, 'mesaj').
 */
export interface Logger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  fatal(fields: LogFields, message: string): void;
  /** Verilen alanlari her kayda ekleyen alt gunlukcu (orn. { rpc, requestId }). */
  child(fields: LogFields): Logger;
}

/**
 * Hicbir sey yazmayan gunlukcu. Testler ve "gunluk istemiyorum" diyen
 * cagirilar icin; uretimde kullanilmaz.
 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silentLogger,
};
