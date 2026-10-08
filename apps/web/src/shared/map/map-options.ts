import type L from 'leaflet';

/**
 * Haritanin davranis ayarlari (saf; birim testi): etkilesim, yakinlastirma
 * capasi ('center': adres haritasi, pin ortada; 'pointer': kurye haritasi,
 * imlecin ya da parmaklarin yeri) ve hareket azaltmada yakinlastirma, solma ve
 * atalet animasyonlari kapali (proje kurali; PM N6).
 */
export function baseMapOptions({
  interactive,
  zoomAround,
  reducedMotion,
}: {
  readonly interactive: boolean;
  readonly zoomAround: 'center' | 'pointer';
  readonly reducedMotion: boolean;
}): L.MapOptions {
  const anchor = zoomAround === 'center' ? 'center' : true;
  const animate = !reducedMotion;
  return {
    zoomControl: interactive,
    dragging: interactive,
    touchZoom: interactive ? anchor : false,
    scrollWheelZoom: interactive ? anchor : false,
    doubleClickZoom: interactive ? anchor : false,
    boxZoom: false,
    keyboard: interactive,
    attributionControl: false,
    zoomAnimation: animate,
    fadeAnimation: animate,
    markerZoomAnimation: animate,
    inertia: animate,
  };
}
