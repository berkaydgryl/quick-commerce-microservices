/**
 * Cizgi ikonlarin ortak SVG ayarlari: renk cevreden (currentColor), boyut
 * kapsayicidan gelir. Ikonlar suslemedir (aria-hidden); anlam yanlarindaki
 * metinde ya da dugmenin aria-label'indadir.
 */
export const STROKE_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;
