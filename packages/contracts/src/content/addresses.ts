/**
 * Adreslerim sekmesi (T11.15; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { addressKindSchema } from '../cart.js';
import { contentTextSchema } from './content-text.js';

/** Adreslerim'in ekleme satiri (T11.15): turu secili acilan ekleme penceresi. */
export const addressAddOptionSchema = z.object({
  kind: addressKindSchema,
  /** "Ev adresi ekle", "İş adresi ekle", "Diğer adres ekle". */
  label: contentTextSchema,
});

/**
 * Adreslerim sekmesi (T11.15; /hesabim/adreslerim): adres listesi, satir
 * eylemleri, ekleme satirlari, duzenleme penceresi ve silme onayi. Bazi
 * metinler adin ARKASINA eklenir (favorites.removedNotice gibi):
 * "Ev" + " " + editSuffix -> "Ev adresini düzenle".
 */
export const addressesContentSchema = z.object({
  /** Sekmenin basligi: "Adreslerim". */
  title: contentTextSchema,
  loadingLabel: contentTextSchema,
  /** Adresi olmayan hesap: ekleme satirlarinin ustunde. */
  emptyNotice: contentTextSchema,
  /** Secili adresin yesil onayi (erisilebilir ad). */
  selectedLabel: contentTextSchema,
  /** Satirin kalemi ve cop kutusu: adin arkasina eklenir. */
  editSuffix: contentTextSchema,
  deleteSuffix: contentTextSchema,
  /** Ekleme satirlari, tur sirasiyla (T4: baslik turun adiyla dolu, varsa "Ev 2"). */
  addOptions: z.array(addressAddOptionSchema).min(1).max(addressKindSchema.options.length),
  /** Duzenleme penceresi (T11.8'in iki adimi) ve icindeki "Adresi sil" (T1). */
  editTitle: contentTextSchema,
  deleteLabel: contentTextSchema,
  /** Silme onayi (T5): soru adin arkasina eklenir; altinda siparislerin etkilenmedigi. */
  confirmTitle: contentTextSchema,
  confirmQuestionSuffix: contentTextSchema,
  confirmHint: contentTextSchema,
  confirmLabel: contentTextSchema,
  deletingLabel: contentTextSchema,
  cancelLabel: contentTextSchema,
  /** Bildirimler: silinen adin arkasina eklenir / guncelleme. */
  deletedToastSuffix: contentTextSchema,
  updatedToast: contentTextSchema,
});

export type AddressesContent = z.infer<typeof addressesContentSchema>;

export type AddressAddOption = z.infer<typeof addressAddOptionSchema>;
