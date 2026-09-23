/**
 * Kirilim noktalarinin JS karsiligi (roadmap P6): matchMedia gereken yerler
 * (harita, sepet cekmecesi) bu degerleri kullanir, kendi sayisini yazmaz.
 *
 * CSS kaynagi src/shared/styles/breakpoints.css'tir. Iki dosya ayni degeri
 * tasimak ZORUNDADIR; test/unit/breakpoints.spec.ts farki yakalar.
 */

/** Kirilimlarin rem cinsinden alt sinirlari (mobil oncelikli: min-width). */
export const BREAKPOINTS_REM = {
  md: 48,
  lg: 64,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS_REM;

/** matchMedia'ya verilecek sorgu: mediaQuery('md') -> '(min-width: 48rem)'. */
export function mediaQuery(breakpoint: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS_REM[breakpoint]}rem)`;
}
