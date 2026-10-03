/**
 * Zarif kapanis (proje kurallari "Node.js ve surec yonetimi"), gRPC
 * servislerindeki siranin realtime karsiligi:
 *
 *   saglik NOT_SERVING (cagiran bayragi once cevirir)
 *   -> Socket.io kapanir: soketler kopar, istemci baska kopyaya yeniden baglanir;
 *      HTTP sunucusu kapanir (adapter da aboneliklerini birakir)
 *   -> Redis baglantilari kapanir
 *   -> metrik ucu kapanir
 *   -> EN SON bekleyen izler gonderilir.
 *
 * Her adim sinirlidir: bitmeyen adim beklenmez, siradakine gecilir ve surec cikar
 * (#56). Adimlar hata firlatmaz; hata gunluge yazilir.
 */

import type { Logger } from '@getir/core';

export interface ShutdownStep {
  /** Gunlukte gorunen ad. */
  readonly name: string;
  readonly run: () => Promise<void>;
  /** Bu sure icinde bitmezse beklenmez (ms). */
  readonly timeoutMs: number;
}

/** Adimlari sirayla, her birini kendi suresiyle calistirir. */
export async function runShutdown(steps: readonly ShutdownStep[], logger: Logger): Promise<void> {
  for (const step of steps) {
    await runStep(step, logger);
  }
}

async function runStep(step: ShutdownStep, logger: Logger): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  // unref EDILMEZ: suren adim bekleyen tek is olsa da sure dolsun ve kapanis bitsin.
  const timedOut = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), step.timeoutMs);
  });
  try {
    const outcome = await Promise.race([step.run().then(() => 'done' as const), timedOut]);
    if (outcome === 'timed-out') {
      logger.error(
        { step: step.name, timeoutMs: step.timeoutMs },
        'kapanis adimi suresinde bitmedi; beklenmiyor',
      );
    }
  } catch (error: unknown) {
    logger.error({ err: error, step: step.name }, 'kapanis adimi hata verdi');
  } finally {
    clearTimeout(timer);
  }
}
