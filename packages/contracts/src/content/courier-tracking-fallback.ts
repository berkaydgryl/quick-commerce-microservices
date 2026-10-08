import type { CourierTrackingContent } from './courier-tracking.js';

/** Kurye takibinin yedegi (F22): icerik gelmese de pencere ve bildirim calisir. */
export const COURIER_TRACKING_FALLBACK: CourierTrackingContent = {
  title: 'Kuryem nerede',
  closeLabel: 'Kapat',
  courierLabel: 'Kuryen',
  mapLabel: 'Kuryenin ve teslimat adresinin haritası',
  etaLabel: 'Tahmini varış',
  etaPrefix: '~',
  minuteSuffix: 'dk',
  distanceLabel: 'Kalan mesafe',
  kilometerSuffix: 'km',
  meterSuffix: 'm',
  addressLabel: 'Teslimat adresi',
  loadingLabel: 'Kuryenin konumu yükleniyor…',
  pickupNotice: 'Kuryen siparişini marketten alıyor; yola çıkınca konumu burada görünür.',
  deliveredNotice: 'Siparişin teslim edildi.',
  unavailableNotice: 'Kuryenin konumu şu an alınamıyor.',
  retryLabel: 'Tekrar dene',
  approachTitle: 'Kuryen konumuna yaklaştı!',
  approachActionLabel: 'Konumu gör',
  approachCloseLabel: 'Bildirimi kapat',
};
