/**
 * Bir sozu sure siniriyla bekler. Zamanlayici HER durumda temizlenir: soz
 * once biterse bekleyen setTimeout event loop'u tutmaz (dinleyici birakilmaz).
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} ${timeoutMs} ms icinde bitmedi`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
