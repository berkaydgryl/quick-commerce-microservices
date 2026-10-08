/**
 * Bir sozu sure siniriyla bekler. Zamanlayici HER durumda temizlenir: soz
 * once biterse bekleyen setTimeout event loop'u tutmaz (dinleyici birakilmaz).
 *
 * Sure dolarsa TimeoutError firlatilir; cagiran bunu isin kendi hatasindan
 * ayirabilir. Is durdurulmaz: arka planda surer, sonucu cagiranin isidir.
 */

/** Sure siniri asildi (isin kendisi hata vermedi, yalnizca gec kaldi). */
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} ${timeoutMs} ms icinde bitmedi`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
