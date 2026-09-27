/**
 * Acilis sarmalayicisi: servisin ayaga kalkma adimlarini (veri kaynagina
 * baglan, indeksleri kur, portu dinle) sarar. Adimlardan biri basarisizsa
 * hatayi TEK SATIR fatal JSON olarak gunluge yazar ve process'i kapatir.
 *
 * NEDEN AYRI BIR ADIM: giris noktalari ust duzey await kullanir. Acilista
 * firlayan hata yakalanmazsa Node onu DUZ METIN yigin izi olarak basar; o anda
 * installProcessHandlers henuz kurulmamistir (kapatilacak sunucu yoktur). Log
 * toplayici satiri JSON olarak okuyamaz ve "servis neden acilmadi?" sorusu
 * konteyner ciktisinda elle aranir.
 */

import type { Logger } from './logger.js';
import { FATAL_EXIT_CODE } from './shutdown.js';

/** Varsayilan gunluk mesaji; servis olmayan araclar (seed) kendi mesajini verir. */
export const STARTUP_FAILURE_MESSAGE = 'servis acilamadi';

export interface StartOrExitOptions {
  readonly logger: Logger;
  readonly message?: string;
  /** Yalnizca test icin: gercek process.exit yerine cagrilir. */
  readonly exit?: (code: number) => void;
}

/**
 * `start` basariliysa sonucunu doner. Basarisizsa fatal gunluk yazar ve
 * FATAL_EXIT_CODE ile cikar. Gercek process.exit geri donmez; enjekte edilen
 * `exit` dondugunde (test) hata yeniden firlatilir, akis devam etmez.
 */
export async function startOrExit<T>(
  start: () => Promise<T>,
  options: StartOrExitOptions,
): Promise<T> {
  try {
    return await start();
  } catch (error: unknown) {
    options.logger.fatal({ err: error }, options.message ?? STARTUP_FAILURE_MESSAGE);
    const exit = options.exit ?? ((code: number) => process.exit(code));
    exit(FATAL_EXIT_CODE);
    throw error;
  }
}
