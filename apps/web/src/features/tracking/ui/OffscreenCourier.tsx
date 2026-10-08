import type { CourierTrackingContent, GeoPoint } from '@getir/contracts';
import type { Map as LeafletMap } from 'leaflet';
import { useId, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import { useEdgePlacement } from '../hooks/useEdgePlacement';
import type { EdgePlacement } from '../services/edge-placement';
import type { EdgeGeometry } from '../services/edge-watch';

import styles from './OffscreenCourier.module.css';
import { COURIER_GLYPH } from './tracking-marker-svg';
import mapStyles from './TrackingMap.module.css';

type OffscreenTexts = Pick<CourierTrackingContent, 'offscreenCourierLabel' | 'distanceLabel'>;

interface OffscreenCourierProps {
  /** Gostergenin merkezi (kenardan iceride, kontrollerin yaninda) ve kuryenin yonu. */
  readonly placement: EdgePlacement;
  /** Adrese kalan mesafe ("650 m", "1,2 km"); teslimde yok. */
  readonly distance: string | undefined;
  readonly texts: OffscreenTexts;
  /** Basinca: harita kuryeye kayar. */
  readonly onShow: () => void;
  /** Gosterge odaktayken kalkarsa (kurye goruse girdi): odak haritaya. */
  readonly onLeave: () => void;
}

/**
 * Ekran disi kurye gostergesi (kullanici istegi): harita kaydirilinca ya da
 * yakinlastirilinca kurye gorunmezse, haritadaki kurye isaretinin kendisi
 * (ayni cizim ve ayni gorunus sinifi) kenara yaslanir; kenarindaki uc
 * kuryenin yonunu gosterir, altinda adrese kalan mesafe. Adi icerikten;
 * mesafe dugmenin aciklamasi ("Kalan mesafe 650 m"). Basinca harita kuryeye
 * kayar. Odaktayken kalkarsa odak bosa dusmez, haritaya gecer.
 */
export function OffscreenCourier({
  placement,
  distance,
  texts,
  onShow,
  onLeave,
}: OffscreenCourierProps) {
  const descriptionId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  // Duzen etkisinin temizligi dugme DOM'dan cikmadan calisir: odak hala onda.
  useLayoutEffect(() => {
    const element = button.current;
    return () => {
      if (element !== null && element === document.activeElement) {
        leave.current();
      }
    };
  }, []);
  const position = {
    '--c-offscreen-courier-x': `${placement.x}px`,
    '--c-offscreen-courier-y': `${placement.y}px`,
    '--c-offscreen-courier-angle': `${placement.angle}deg`,
  } as CSSProperties;
  return (
    <button
      ref={button}
      type="button"
      className={styles['c-offscreen-courier']}
      style={position}
      aria-label={texts.offscreenCourierLabel}
      aria-describedby={distance === undefined ? undefined : descriptionId}
      onClick={onShow}
    >
      <span
        className={`${styles['c-offscreen-courier__disc'] ?? ''} ${mapStyles['c-tracking-map__marker--courier'] ?? ''}`}
        aria-hidden="true"
      >
        <span className={styles['c-offscreen-courier__pointer']} />
        <CourierGlyph />
      </span>
      {distance !== undefined && (
        <span id={descriptionId} className={styles['c-offscreen-courier__distance']}>
          <span className={styles['c-offscreen-courier__sr']}>{texts.distanceLabel} </span>
          {distance}
        </span>
      )}
    </button>
  );
}

interface OffscreenCourierLayerProps extends Omit<OffscreenCourierProps, 'placement'> {
  readonly leaflet: LeafletMap | null;
  readonly location: GeoPoint | undefined;
  /** Kurye isaretinin yaricapi, kenar payi ve Leaflet kontrolleri (px). */
  readonly geometry: EdgeGeometry;
}

/**
 * Gostergenin katmani: haritayi izler (useEdgePlacement); harita kaydikca
 * yalniz bu katman yeniden cizilir, haritanin bileseni degil.
 */
export function OffscreenCourierLayer({
  leaflet,
  location,
  geometry,
  ...props
}: OffscreenCourierLayerProps) {
  const placement = useEdgePlacement(leaflet, location, geometry);
  return placement === null ? null : <OffscreenCourier placement={placement} {...props} />;
}

/** Haritadaki kurye isaretinin cizimi (tek kaynak: COURIER_GLYPH). */
function CourierGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {COURIER_GLYPH.wheels.map(({ cx, cy, r }) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
      {COURIER_GLYPH.strokes.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
