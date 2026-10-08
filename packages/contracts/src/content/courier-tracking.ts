/**
 * Kurye takibi (F22; T13.3 asama 1): "Kuryem nerede" penceresi ve yaklasma
 * bildirimi. Pencere: basligi, "Kuryen" ve kisaltilmis ad, harita, tahmini
 * varis ("~8 dk") ve kalan mesafe ("1,2 km", "300 m"), teslimat adresi; harita
 * kaydirilinca kurye gorunmezse kenarda kurye gostergesi ve mesafe; paket
 * alinmadan (TO_MARKET) konum yok, teslimde ve takip yokken kendi cumleleri.
 * Bildirim: kurye konuma yaklasinca sag ustte bir kez, "Konumu gör" ayni
 * pencereyi acar.
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

export const courierTrackingContentSchema = z.object({
  title: contentTextSchema,
  closeLabel: contentTextSchema,
  courierLabel: contentTextSchema,
  mapLabel: contentTextSchema,
  etaLabel: contentTextSchema,
  etaPrefix: contentTextSchema,
  minuteSuffix: contentTextSchema,
  distanceLabel: contentTextSchema,
  kilometerSuffix: contentTextSchema,
  meterSuffix: contentTextSchema,
  addressLabel: contentTextSchema,
  loadingLabel: contentTextSchema,
  pickupNotice: contentTextSchema,
  deliveredNotice: contentTextSchema,
  unavailableNotice: contentTextSchema,
  retryLabel: contentTextSchema,
  approachTitle: contentTextSchema,
  approachActionLabel: contentTextSchema,
  approachCloseLabel: contentTextSchema,
  /** Ekran disi kurye gostergesi (harita kaydirilinca): dugmenin erisilebilir adi. */
  offscreenCourierLabel: contentTextSchema,
});

export type CourierTrackingContent = z.infer<typeof courierTrackingContentSchema>;
