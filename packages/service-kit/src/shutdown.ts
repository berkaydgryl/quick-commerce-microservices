/**
 * Process yasam dongusu: sinyaller ve yakalanmamis hatalar.
 *
 * Konteyner dunyasinda kapanis bir ISTEKTIR: orkestrator once SIGTERM gonderir,
 * belli bir sure (Kubernetes'te varsayilan 30 sn) bekler, sonra SIGKILL ile
 * oldurur. Bu pencereyi kullanmazsak devam eden her cagri yarida kesilir ve
 * yarim kalmis rezervasyon/odeme kaydi ureten yaris kosullari dogar.
 *
 * Yakalanmamis hata ve reddedilmis soz de buraya baglidir: Node'un varsayilan
 * davranisi processi ANINDA devirmektir; biz once gunluge yaziyor, sonra ayni
 * zarif kapanistan geciriyoruz - ama uygulamayi AYAKTA TUTMUYORUZ. Bilinmeyen
 * durumdaki bir processe cagri gondermeye devam etmek, kapanmasindan daha
 * tehlikelidir.
 */

import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';

/** Kapanis istegi uretecek sinyaller. Windows'ta yalnizca SIGINT anlamlidir. */
export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Yakalanmamis hata sonrasi cikis kodu (128 + SIGABRT gelenegi degil, duz 1). */
export const FATAL_EXIT_CODE = 1;

export interface ProcessLifecycleOptions {
  /** Zarif kapanis; genelde startGrpcServer'in dondurdugu handle.shutdown. */
  readonly shutdown: (reason: string) => Promise<void>;
  readonly logger?: Logger;
  /** Yalnizca test icin: gercek process.exit yerine cagrilir. */
  readonly exit?: (code: number) => void;
  readonly signals?: readonly NodeJS.Signals[];
}

/**
 * Sinyal ve hata dinleyicilerini kurar.
 * @returns Dinleyicileri kaldiran fonksiyon (testler ve yeniden kurulum icin).
 */
export function installProcessHandlers(options: ProcessLifecycleOptions): () => void {
  const logger = options.logger ?? silentLogger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? SHUTDOWN_SIGNALS;

  const onSignal = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'kapanis sinyali alindi');
    void options
      .shutdown(signal)
      .catch((error: unknown) => {
        logger.error({ err: error }, 'kapanis sirasinda hata');
      })
      .finally(() => {
        // Sifir cikis kodu: bu bir hata degil, istenen kapanis.
        exit(0);
      });
  };

  const onFatal = (kind: string) => (error: unknown) => {
    logger.fatal({ err: error, kind }, 'yakalanmamis hata, process kapaniyor');
    void options
      .shutdown(kind)
      .catch(() => undefined)
      .finally(() => {
        exit(FATAL_EXIT_CODE);
      });
  };

  const onUncaughtException = onFatal('uncaughtException');
  const onUnhandledRejection = onFatal('unhandledRejection');

  for (const signal of signals) {
    process.on(signal, onSignal);
  }
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  return () => {
    for (const signal of signals) {
      process.off(signal, onSignal);
    }
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  };
}
