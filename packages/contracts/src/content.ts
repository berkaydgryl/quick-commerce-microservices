/**
 * Icerik uclarinin semalari (T11.6).
 *
 * Karsilama ekraninin butun metinleri ve gorselleri bu sozlesmeden gecer:
 * web kodunda ekran metni sabit yazilmaz. Bugun kaynak gateway'e gomulu
 * dosyadir (internal/content/welcome.json); bir CMS baglaninca uc ve bu sema
 * degismez, yalnizca kaynak degisir.
 *
 * Form KURALLARI ve hata cumleleri burada degildir: onlar auth.ts'teki
 * semalardan gelir, cunku gateway ayni kurali ayni cumleyle uygular. Buradaki
 * metinler yalnizca etiket, baslik ve dugme yazisidir.
 */

import { z } from 'zod';

import { addressKindSchema } from './cart.js';
import { storeTypeSchema } from './catalog.js';
import { geoPointSchema } from './common.js';

import {
  CONTENT_BANNER_SOURCES_MAX,
  CONTENT_FEATURES_MAX,
  CONTENT_MAP_ZOOM_MAX,
  CONTENT_MAP_ZOOM_MIN,
  CONTENT_PHONE_COUNTRIES_MAX,
  CONTENT_STORE_LINKS_MAX,
  CONTENT_TEXT_MAX_LENGTH,
  COUNTRY_CODE_PATTERN,
  DIAL_CODE_PATTERN,
} from './constants.js';

/** Ekranda gorunen bir metin; bos olamaz. */
const contentTextSchema = z.string().min(1).max(CONTENT_TEXT_MAX_LENGTH);

/** Mutlak gorsel adresi; veri goreli yol saklar, gateway ASSET_BASE_URL ile kurar. */
const contentImageUrlSchema = z.string().url();

/** Banner'in bir boyu. */
export const bannerSourceSchema = z.object({
  url: contentImageUrlSchema,
  /** Dosyanin piksel genisligi: tarayici srcset'ten ekrana uygun boyu secer. */
  width: z.number().int().positive(),
});

/**
 * Karsilama banner'i: ayni gorselin boylari ve dogal boyutu. Boyut, oran icin
 * gelir: tarayici yeri onceden ayirir, gorsel inince sayfa ziplamaz. Ayni
 * genislik iki kez yazilamaz (srcset'te gecersiz olur).
 */
export const bannerSchema = z.object({
  sources: z
    .array(bannerSourceSchema)
    .min(1)
    .max(CONTENT_BANNER_SOURCES_MAX)
    .refine((sources) => new Set(sources.map((source) => source.width)).size === sources.length, {
      message: 'ayni genislik iki kez yazilamaz',
    }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Ulke kodu secicisinin bir satiri. Telefon kurali (PHONE_PATTERN) bugun
 * yalnizca +90 kabul eder; listedeki baska bir kod formda reddedilir.
 */
export const phoneCountrySchema = z.object({
  /** ISO 3166-1 alfa-2: "TR". */
  code: z.string().regex(COUNTRY_CODE_PATTERN),
  name: contentTextSchema,
  /** "+90". */
  dialCode: z.string().regex(DIAL_CODE_PATTERN),
  flagUrl: contentImageUrlSchema,
});

/** Giris penceresi: telefon + sifre (kayitli kullanici). */
export const loginStepContentSchema = z.object({
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  /** Istek surerken dugmede gorunen metin. */
  pendingLabel: contentTextSchema,
  /** "Hesabin yok mu?" + kayit penceresine gecen baglanti. */
  registerPrompt: contentTextSchema,
  registerLinkLabel: contentTextSchema,
  /** Kayitsiz numara yazilinca telefonun altinda (T11.7): "hesap yok" + kayit baglantisi. */
  unknownPhoneNotice: contentTextSchema,
});

/** Kayit penceresi: ad soyad, telefon ve sifre. */
export const registerStepContentSchema = z.object({
  fullNameLabel: contentTextSchema,
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  pendingLabel: contentTextSchema,
  /** "Zaten hesabin var mi?" + giris penceresine donen baglanti. */
  loginPrompt: contentTextSchema,
  loginLinkLabel: contentTextSchema,
  /** Kayitli numara yazilinca telefonun altinda (T11.7): "hesap var" + giris baglantisi. */
  knownPhoneNotice: contentTextSchema,
});

/**
 * Sifre yenileme penceresi (T11.9; "Sifremi unuttum"): telefon ve yeni sifre.
 * Kayitsiz numara uyarisi giris adimininkiyle aynidir (login.unknownPhoneNotice).
 */
export const resetPasswordStepContentSchema = z.object({
  title: contentTextSchema,
  /** Basligin altindaki kisa aciklama. */
  description: contentTextSchema,
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  pendingLabel: contentTextSchema,
  /** "Sifreni hatirladin mi?" + giris penceresine donen baglanti. */
  loginPrompt: contentTextSchema,
  loginLinkLabel: contentTextSchema,
});

/**
 * Karsilama karti (telefon + "Devam Et") ile giris ve kayit penceresinin
 * metinleri. Gelistirmeye ozel demo hesap listesinin metni burada YOKTUR: o
 * arac production paketine hic girmez.
 */
export const loginCardContentSchema = z.object({
  title: contentTextSchema,
  /** Ulke kodu secicisinin erisilebilir adi. */
  countryLabel: contentTextSchema,
  phoneLabel: contentTextSchema,
  phonePlaceholder: contentTextSchema,
  continueLabel: contentTextSchema,
  /** Giris ve kayit penceresinin kapat (X) dugmesinin erisilebilir adi. */
  closeLabel: contentTextSchema,
  /** Sifre alanindaki goster/gizle dugmesinin erisilebilir adi (aria-pressed ile). */
  showPasswordLabel: contentTextSchema,
  countries: z
    .array(phoneCountrySchema)
    .min(1)
    .max(CONTENT_PHONE_COUNTRIES_MAX)
    .refine(
      (countries) => new Set(countries.map((country) => country.code)).size === countries.length,
      {
        message: 'ayni ulke iki kez yazilamaz',
      },
    ),
  /** Karttaki ve giris penceresindeki "Sifremi unuttum" baglantisi (T11.9). */
  forgotPasswordLabel: contentTextSchema,
  login: loginStepContentSchema,
  register: registerStepContentSchema,
  resetPassword: resetPasswordStepContentSchema,
});

/** Tek boy bir gorsel: adres ve dogal boyut (yer onceden ayrilir, sayfa ziplamaz). */
export const contentImageSchema = z.object({
  url: contentImageUrlSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Magaza rozeti (T11.7): baglanti yeni sekmede magaza sayfasini acar. Adres
 * yalnizca https olabilir (disari giden baglanti; gateway kurmaz, oldugu gibi
 * tasir).
 */
export const storeLinkSchema = z.object({
  /** Baglantinin erisilebilir adi ve rozetin alt metni: "App Store'dan indir". */
  label: contentTextSchema,
  url: z.string().url().startsWith('https://'),
  badge: contentImageSchema,
});

/** Uygulama indirme bandi (T11.7): solda baslik, alt metin ve rozetler; sagda telefon gorseli. */
export const appDownloadContentSchema = z.object({
  title: contentTextSchema,
  subtitle: contentTextSchema,
  /** Susleme: anlam metindedir, alt metni bostur. */
  image: contentImageSchema,
  stores: z.array(storeLinkSchema).min(1).max(CONTENT_STORE_LINKS_MAX),
});

/** Tanitim kutusu (T11.7): gorsel (susleme) + metin. */
export const featureContentSchema = z.object({
  image: contentImageSchema,
  text: contentTextSchema,
});

/** Adres turu secenegi (T11.8): "Ev" + ikon (emoji). */
export const addressKindOptionSchema = z.object({
  kind: addressKindSchema,
  label: contentTextSchema,
  icon: contentTextSchema,
});

/**
 * Harita (T11.8): OpenStreetMap karolari. Karo adresi https ve {z}/{x}/{y}
 * yer tutuculu; atif metni OSM lisansi geregi haritada gorunur. Baslangic
 * noktasi demo marketlerin oldugu semt.
 */
export const mapContentSchema = z.object({
  tileUrl: z
    .string()
    .startsWith('https://')
    .refine((url) => ['{z}', '{x}', '{y}'].every((part) => url.includes(part)), {
      message: 'karo adresi {z}, {x} ve {y} tasimali',
    }),
  attribution: contentTextSchema,
  center: geoPointSchema,
  zoom: z.number().int().min(CONTENT_MAP_ZOOM_MIN).max(CONTENT_MAP_ZOOM_MAX),
});

/**
 * Adres ekleme penceresi (T11.8): oturum acik ama kayitli adres yoksa
 * karsilama ekraninin ustunde acilir. 1. adim harita + arama + "Bu adresi
 * kullan"; 2. adim detay (baslik, adres, bina/kat/daire, tarif) + "Kaydet".
 */
export const addressSetupContentSchema = z.object({
  title: contentTextSchema,
  /** 2. adimdaki geri dugmesinin erisilebilir adi. */
  backLabel: contentTextSchema,
  pinHint: contentTextSchema,
  searchLabel: contentTextSchema,
  searchPlaceholder: contentTextSchema,
  searchSubmitLabel: contentTextSchema,
  searchEmptyNotice: contentTextSchema,
  useAddressLabel: contentTextSchema,
  resolvingLabel: contentTextSchema,
  /** Pinin oldugu yer icin adres bulunamadi: satiri kullanici yazar. */
  unresolvedNotice: contentTextSchema,
  kindLabel: contentTextSchema,
  kinds: z
    .array(addressKindOptionSchema)
    .min(1)
    .max(addressKindSchema.options.length)
    .refine((kinds) => new Set(kinds.map((option) => option.kind)).size === kinds.length, {
      message: 'ayni adres turu iki kez yazilamaz',
    }),
  titleLabel: contentTextSchema,
  lineLabel: contentTextSchema,
  buildingLabel: contentTextSchema,
  floorLabel: contentTextSchema,
  apartmentLabel: contentTextSchema,
  noteLabel: contentTextSchema,
  saveLabel: contentTextSchema,
  savingLabel: contentTextSchema,
  /** Secilen yere hizmet veren market yok: uyari, kaydi engellemez. */
  noMarketNotice: contentTextSchema,
  map: mapContentSchema,
});

/**
 * Uygulamanin ust bari (T11.10): oturumlu sayfalarin (ana sayfa, marketler,
 * market, hesabim) mor bari. Logo | arama kutusu (icinde teslimat adresi) |
 * Profil. Oturumsuz ziyaretci ayni bari "Giris yap" ile gorur
 * (header.loginLabel).
 */
export const appHeaderContentSchema = z.object({
  /** Arama kutusunun erisilebilir adi ve ipucu: "Market veya urun ara". */
  searchLabel: contentTextSchema,
  searchPlaceholder: contentTextSchema,
  searchClearLabel: contentTextSchema,
  /** Kutunun icindeki adres dugmesinin erisilebilir adinin basi: "Teslimat adresi: Ev". */
  addressLabel: contentTextSchema,
  addressListLabel: contentTextSchema,
  /**
   * Adres dugmesinin actigi "Adreslerim" penceresi: radyo listesi, "Adresi
   * Onayla" ve alt bantta "Baska bir adreste misin? Adres Ekle" (harita +
   * detay; T11.8'in penceresi).
   */
  addressBookTitle: contentTextSchema,
  addressConfirmLabel: contentTextSchema,
  addressAddPrompt: contentTextSchema,
  addressAddLabel: contentTextSchema,
  /** Oturumsuz ziyaretci varsayilan adresi gorur; dugme giris ekranina gider. */
  addressLoginLabel: contentTextSchema,
  noAddressNotice: contentTextSchema,
  addressLoadingLabel: contentTextSchema,
  profileLabel: contentTextSchema,
  accountLabel: contentTextSchema,
  /** Profil menusunun favori sayfasi baglantisi (T11.13). */
  favoritesLabel: contentTextSchema,
  logoutLabel: contentTextSchema,
  logoutPendingLabel: contentTextSchema,
});

/** Dukkan turunun adi (T11.12): sol menude ve ciplerde "Kasap". */
export const storeTypeLabelSchema = z.object({
  type: storeTypeSchema,
  label: contentTextSchema,
});

/**
 * Sol menunun akordeon grubu (T11.12; referans getircarsi "Kategoriler"):
 * "Gida & Market" satiri acilinca o gruptaki turler sayilariyla listelenir.
 * Hangi turun hangi grupta oldugu icerikten gelir, kodda sabit degildir.
 */
export const storeTypeGroupSchema = z.object({
  label: contentTextSchema,
  /** Satirdaki kucuk gorsel; mutlak URL (gateway kurar). */
  imageUrl: contentImageUrlSchema,
  types: z.array(storeTypeSchema).min(1),
});

/** Sagdaki Sepetim paneli ve telefondaki sepet cubugu (T11.12). */
export const marketListCartContentSchema = z.object({
  title: contentTextSchema,
  emptyTitle: contentTextSchema,
  emptyHint: contentTextSchema,
  /** Urun sayisinin birimi: "3 ürün". */
  itemCountLabel: contentTextSchema,
  subtotalLabel: contentTextSchema,
  deliveryLabel: contentTextSchema,
  /** Teslimat ucreti 0 iken tutarin yerine. */
  freeDeliveryLabel: contentTextSchema,
  totalLabel: contentTextSchema,
  /** "Minimum sepet tutarına kalan: 25,10 TL". */
  minBasketRemainingLabel: contentTextSchema,
  goToCartLabel: contentTextSchema,
  clearLabel: contentTextSchema,
});

/** Her tur tam bir kez: liste sozlesmedeki turlerle birebir. */
function coversEveryStoreTypeOnce(types: readonly string[]): boolean {
  return (
    types.length === storeTypeSchema.options.length &&
    storeTypeSchema.options.every((type) => types.includes(type))
  );
}

/**
 * Market listesi ekrani (T11.12; referans getircarsi "N isletme listeleniyor"):
 * solda dukkan turleri (gruplu, sayili), ortada market kartlari, sagda
 * Sepetim. Para ve sure bicimi istemcidedir; burada yalnizca etiketler.
 */
export const marketListContentSchema = z
  .object({
    categoriesTitle: contentTextSchema,
    /** Telefondaki ciplerin ilki: suzgec yok. */
    allLabel: contentTextSchema,
    /** Sayinin arkasi: "21 işletme listeleniyor". */
    countLabel: contentTextSchema,
    clearFilterLabel: contentTextSchema,
    loadingLabel: contentTextSchema,
    emptyNotice: contentTextSchema,
    /** Secili turde adrese hizmet veren market yok. */
    filterEmptyNotice: contentTextSchema,
    /** Puanin ve degerlendirme sayisinin erisilebilir adlari. */
    ratingLabel: contentTextSchema,
    ratingCountLabel: contentTextSchema,
    minBasketLabel: contentTextSchema,
    /** Esigin arkasi: "300,00 TL üzeri ücretsiz teslimat". */
    freeDeliveryThresholdLabel: contentTextSchema,
    closedLabel: contentTextSchema,
    storeTypes: z.array(storeTypeLabelSchema),
    groups: z.array(storeTypeGroupSchema).min(1),
    cart: marketListCartContentSchema,
  })
  .superRefine((content, context) => {
    if (!coversEveryStoreTypeOnce(content.storeTypes.map((option) => option.type))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storeTypes'],
        message: 'her dukkan turunun adi tam bir kez yazilmali',
      });
    }
    if (!coversEveryStoreTypeOnce(content.groups.flatMap((group) => group.types))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groups'],
        message: 'her dukkan turu tam bir gruba ait olmali',
      });
    }
  });

/**
 * Favori marketler (T11.13; referans getircarsi "Favori Isletmelerim"):
 * kartlardaki kalp, profil sayfasinin menusu ve favori sayfasi. Hata
 * bildirimleri (toast) de buradan: kalp tiklamasi sunucuda basarisiz olursa
 * kalp eski haline doner ve bildirim cikar.
 */
export const favoritesContentSchema = z.object({
  /** Favori sayfasinin basligi: "Favori İşletmelerim". */
  title: contentTextSchema,
  /** Kalbin erisilebilir adi: favori degilken / favoriyken. */
  addLabel: contentTextSchema,
  removeLabel: contentTextSchema,
  loadingLabel: contentTextSchema,
  emptyTitle: contentTextSchema,
  emptyHint: contentTextSchema,
  /** Favori sayfasinda kart kaldirilinca ekran okuyucu duyurusu: "Moda Kasabı favorilerden çıkarıldı". */
  removedNotice: contentTextSchema,
  updateFailedToast: contentTextSchema,
  /** Liste FAVORITE_MARKETS_MAX'a ulasti. */
  listFullToast: contentTextSchema,
  toastDismissLabel: contentTextSchema,
  /** Profil sayfasinin sol menusu: erisilebilir adi ve maddeleri (D4: calisanlar). */
  profileMenuLabel: contentTextSchema,
  addressesLabel: contentTextSchema,
  favoritesMenuLabel: contentTextSchema,
});

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

/** GET /v1/content/welcome - oturumsuz ziyaretcinin karsilama ekrani. */
export const welcomeContentSchema = z.object({
  header: z.object({
    /** Logonun iki parcasi: "getir" + "market". */
    brand: contentTextSchema,
    service: contentTextSchema,
    loginLabel: contentTextSchema,
    registerLabel: contentTextSchema,
  }),
  hero: z.object({
    /** Sayfanin h1'i ve banner'in alt metni: slogan gorselin icinde yazilidir. */
    title: contentTextSchema,
    banner: bannerSchema,
  }),
  loginCard: loginCardContentSchema,
  categories: z.object({
    title: contentTextSchema,
  }),
  appDownload: appDownloadContentSchema,
  features: z.array(featureContentSchema).min(1).max(CONTENT_FEATURES_MAX),
  addressSetup: addressSetupContentSchema,
  appHeader: appHeaderContentSchema,
  marketList: marketListContentSchema,
  favorites: favoritesContentSchema,
  profile: profileContentSchema,
  /** Adreslerim sekmesi (T11.15). */
  addresses: addressesContentSchema,
});

export type BannerSource = z.infer<typeof bannerSourceSchema>;
export type Banner = z.infer<typeof bannerSchema>;
export type PhoneCountry = z.infer<typeof phoneCountrySchema>;
export type LoginStepContent = z.infer<typeof loginStepContentSchema>;
export type RegisterStepContent = z.infer<typeof registerStepContentSchema>;
export type LoginCardContent = z.infer<typeof loginCardContentSchema>;
export type ContentImage = z.infer<typeof contentImageSchema>;
export type StoreLink = z.infer<typeof storeLinkSchema>;
export type AppDownloadContent = z.infer<typeof appDownloadContentSchema>;
export type FeatureContent = z.infer<typeof featureContentSchema>;
export type AddressKindOption = z.infer<typeof addressKindOptionSchema>;
export type MapContent = z.infer<typeof mapContentSchema>;
export type AddressSetupContent = z.infer<typeof addressSetupContentSchema>;
export type ResetPasswordStepContent = z.infer<typeof resetPasswordStepContentSchema>;
export type AppHeaderContent = z.infer<typeof appHeaderContentSchema>;
export type StoreTypeLabel = z.infer<typeof storeTypeLabelSchema>;
export type StoreTypeGroup = z.infer<typeof storeTypeGroupSchema>;
export type MarketListCartContent = z.infer<typeof marketListCartContentSchema>;
export type MarketListContent = z.infer<typeof marketListContentSchema>;
export type FavoritesContent = z.infer<typeof favoritesContentSchema>;
export type AddressesContent = z.infer<typeof addressesContentSchema>;
export type AddressAddOption = z.infer<typeof addressAddOptionSchema>;
export type EmailDialogContent = z.infer<typeof emailDialogContentSchema>;
export type EditProfileDialogContent = z.infer<typeof editProfileDialogContentSchema>;
export type PhoneDialogContent = z.infer<typeof phoneDialogContentSchema>;
export type ProfileContent = z.infer<typeof profileContentSchema>;
export type WelcomeContent = z.infer<typeof welcomeContentSchema>;
