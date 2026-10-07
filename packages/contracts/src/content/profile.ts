/**
 * Profil karti ve pencereleri (T11.14; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { contentTextSchema } from './content-text.js';

/**
 * E-posta penceresi (T11.14): iki adim. Once adres ve "Kod gönder", sonra
 * gonderilen adres, 6 haneli kod, gecerlilik geri sayimi ve yeniden gonderme.
 * Sureler (dakika:saniye) etiketin arkasina yazilir: "Kodun geçerlilik süresi 09:41".
 */
export const emailDialogContentSchema = z.object({
  title: contentTextSchema,
  closeLabel: contentTextSchema,
  /** Adres adimi. */
  emailDescription: contentTextSchema,
  emailFieldLabel: contentTextSchema,
  sendLabel: contentTextSchema,
  sendingLabel: contentTextSchema,
  /** Kod adimi: "Doğrulama kodunu şu adrese gönderdik:" ve altinda adres. */
  codeSentToLabel: contentTextSchema,
  codeFieldLabel: contentTextSchema,
  verifyLabel: contentTextSchema,
  verifyingLabel: contentTextSchema,
  expiresInLabel: contentTextSchema,
  expiredNotice: contentTextSchema,
  resendLabel: contentTextSchema,
  /** Yeniden gonderme kapaliyken: "Yeni kodu isteyebilmen için 0:42". */
  resendWaitLabel: contentTextSchema,
  changeEmailLabel: contentTextSchema,
  /** Basarida cikan bildirim (toast). */
  verifiedToast: contentTextSchema,
});

/**
 * "Profili düzenle" penceresi (T11.14 PR 3): ad yerinde duzenlenir, e-posta ve
 * telefon satirlari kendi adimlarini acar (e-posta: emailDialog, telefon:
 * phoneDialog). Alt adimlardan genel gorunume geri oku doner.
 */
export const editProfileDialogContentSchema = z.object({
  title: contentTextSchema,
  closeLabel: contentTextSchema,
  backLabel: contentTextSchema,
  nameLabel: contentTextSchema,
  saveNameLabel: contentTextSchema,
  savingNameLabel: contentTextSchema,
  nameSavedToast: contentTextSchema,
  emailLabel: contentTextSchema,
  phoneLabel: contentTextSchema,
  /** E-postasi olmayan hesapta e-posta satirinin degeri. */
  emptyEmailLabel: contentTextSchema,
  changeLabel: contentTextSchema,
  addLabel: contentTextSchema,
  /** Dogrulanmamis numaranin yanindaki baglanti. */
  verifyLabel: contentTextSchema,
});

/**
 * Telefon adimi (T11.14 PR 3): numara degistirme (yeni numara ve sifre) ya da
 * simdiki numarayi dogrulama, sonra e-postadakiyle ayni kod adimi.
 */
export const phoneDialogContentSchema = z.object({
  title: contentTextSchema,
  /** Numara degistirirken (sifre sorulur). */
  changeDescription: contentTextSchema,
  /** Simdiki numarayi dogrularken (sifre sorulmaz). */
  verifyDescription: contentTextSchema,
  phoneFieldLabel: contentTextSchema,
  passwordLabel: contentTextSchema,
  showPasswordLabel: contentTextSchema,
  hidePasswordLabel: contentTextSchema,
  sendLabel: contentTextSchema,
  sendingLabel: contentTextSchema,
  codeSentToLabel: contentTextSchema,
  codeFieldLabel: contentTextSchema,
  verifyLabel: contentTextSchema,
  verifyingLabel: contentTextSchema,
  expiresInLabel: contentTextSchema,
  expiredNotice: contentTextSchema,
  resendLabel: contentTextSchema,
  resendWaitLabel: contentTextSchema,
  changePhoneLabel: contentTextSchema,
  verifiedToast: contentTextSchema,
  /** Numara degisince: diger cihazlar disari cikar. */
  changedToast: contentTextSchema,
});

/**
 * Profil karti (T11.14; PR 2'de referansa gore: getircarsi profil sayfasi):
 * ad, altinda e-posta, onun altinda telefon; kartin ust kenarinda kalem
 * ("Profili düzenle", PR 3). Dogrulanmis e-postanin yaninda yesil onay;
 * telefonun yaninda yalnizca numara SMS koduyla dogrulanmissa (PR 3), yoksa
 * "Doğrula" baglantisi (kayit numarayi dogrulamaz, ADR-12).
 * Satir ikonlarinin ve onayin erisilebilir adlari buradadir.
 */
export const profileContentSchema = z.object({
  phoneLabel: contentTextSchema,
  emailLabel: contentTextSchema,
  /** E-postasi olmayan kartin e-posta satirindaki baglanti. */
  addEmailLabel: contentTextSchema,
  /** Kalemin erisilebilir adi: "Profili düzenle" penceresini acar (PR 3). */
  editProfileLabel: contentTextSchema,
  /** Yesil onayin erisilebilir adi. */
  verifiedLabel: contentTextSchema,
  /** Dogrulanmamis numaranin yanindaki baglanti (PR 3). */
  verifyPhoneLabel: contentTextSchema,
  loadingLabel: contentTextSchema,
  editDialog: editProfileDialogContentSchema,
  emailDialog: emailDialogContentSchema,
  phoneDialog: phoneDialogContentSchema,
});

export type EmailDialogContent = z.infer<typeof emailDialogContentSchema>;

export type EditProfileDialogContent = z.infer<typeof editProfileDialogContentSchema>;

export type PhoneDialogContent = z.infer<typeof phoneDialogContentSchema>;

export type ProfileContent = z.infer<typeof profileContentSchema>;
