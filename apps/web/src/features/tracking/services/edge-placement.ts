/**
 * Ekran disi kurye gostergesinin yeri (kullanici istegi): kurye haritanin
 * gorunen alaninin disindaysa, haritanin merkezinden kuryeye giden dogrunun
 * kenari kestigi nokta ve yonu (derece; 0 sag, 90 asagi). Kuryenin isaretinin
 * bir parcasi bile gorunuyorsa (merkez kenardan `margin` kadar disarida olsa
 * da) null: iki kurye birden gorunmez. Saf: Leaflet'siz; kabin boyu ve
 * kuryenin kap icindeki pikseli verilir. Nokta tam kenardadir; gostergeyi
 * iceride tutan pay CSS'te (token).
 */

export interface EdgePlacement {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

export function edgePlacement(
  size: { readonly width: number; readonly height: number },
  point: { readonly x: number; readonly y: number },
  /** Kurye isaretinin yaricapi (px): isaret kenardan bu kadar tasana dek gorunur sayilir. */
  margin = 0,
): EdgePlacement | null {
  const { width, height } = size;
  const inside =
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin;
  // Henuz yerlesmemis kap (boyut 0): yon hesaplanamaz, gosterge yok.
  if (inside || width <= 0 || height <= 0) {
    return null;
  }
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : centerX / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : centerY / Math.abs(dy),
  );
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
    angle: Math.atan2(dy, dx) * DEGREES_PER_RADIAN,
  };
}

/** Ayni yer ve yon mu (gereksiz yeniden cizim olmasin). */
export function samePlacement(a: EdgePlacement | null, b: EdgePlacement | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.angle === b.angle);
}

/** Kap icinde dikdortgen (px): Leaflet kontrolu (yakinlastirma, atif). */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Gostergenin merkezi: kenar noktasi kaptan `inset` (gostergenin yarim boyu +
 * bosluk) kadar iceri cekilir ve Leaflet kontrollerinin ustune binmez;
 * cakisirsa kenar boyunca kontrolun yanina kayar (sol ve sag kenarda dikey,
 * ust ve alt kenarda yatay), kap icinde kalan en yakin yana. Yon degismez.
 */
export function indicatorCenter(
  placement: EdgePlacement,
  size: { readonly width: number; readonly height: number },
  inset: number,
  obstacles: readonly Rect[],
): EdgePlacement {
  const { width, height } = size;
  let x = clamp(placement.x, inset, width - inset);
  let y = clamp(placement.y, inset, height - inset);
  const sideEdge = placement.x <= 0 || placement.x >= width;
  for (const rect of obstacles) {
    const box = {
      left: rect.left - inset,
      top: rect.top - inset,
      right: rect.right + inset,
      bottom: rect.bottom + inset,
    };
    if (x <= box.left || x >= box.right || y <= box.top || y >= box.bottom) {
      continue;
    }
    if (sideEdge) {
      y = nearestInside(y, [box.top, box.bottom], inset, height - inset);
    } else {
      x = nearestInside(x, [box.left, box.right], inset, width - inset);
    }
  }
  return { x, y, angle: placement.angle };
}

/** Adaylardan kap icinde kalan en yakini; hicbiri sigmiyorsa deger aynen. */
function nearestInside(value: number, candidates: number[], low: number, high: number): number {
  const fitting = candidates.filter((candidate) => candidate >= low && candidate <= high);
  if (fitting.length === 0) {
    return value;
  }
  return fitting.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}
