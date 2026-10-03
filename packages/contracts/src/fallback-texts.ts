/**
 * Icerik yedegi (T11.10 duzeltmesi): GET /v1/content/welcome hata verirse
 * ust barin calismasi icin gereken en az metin. Oturumdaki kullanici icerik
 * gelmese de cikis yapabilmeli, Hesabim'a gidebilmeli ve yeniden deneyebilmeli.
 *
 * Ekran metninin tek kaynagi icerik ucudur; bu sozluk yalnizca o uc
 * ulasilamazken kullanilir (errors.ts'teki hata sozlugu kalibi). Degerler
 * gateway'in welcome.json'daki karsiliklariyla AYNIDIR; contracts testi iki
 * yeri karsilastirir, biri degisip digeri unutulursa kirmizi olur.
 */
export const CONTENT_FALLBACK = {
  /** header.brand ve header.service: logonun iki parcasi. */
  brand: 'getir',
  service: 'market',
  /** header.loginLabel. */
  loginLabel: 'Giriş yap',
  /** appHeader.profileLabel, accountLabel, logoutLabel, logoutPendingLabel. */
  profileLabel: 'Profil',
  accountLabel: 'Hesabım',
  logoutLabel: 'Çıkış yap',
  logoutPendingLabel: 'Çıkış yapılıyor…',
  /** Icerigi yeniden isteyen dugme (icerikte karsiligi yok: icerik gelmeyince gorunur). */
  retryLabel: 'Tekrar dene',
} as const;

export type ContentFallback = typeof CONTENT_FALLBACK;
