import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { sessionLock } from '../../../shared/session/session';
import { logoutSession } from '../api/auth.api';
import { HOME_PATH } from '../services/next-path';

/** Sayfayi verilen adrese yeniden yukler; gecmiste cikilan sayfa kalmaz. */
function reloadAt(path: string): void {
  window.location.replace(path);
}

/**
 * Cikis (T8.5): gateway yenileme jetonunu iptal eder ve cerezi siler; sonra
 * sayfa ana sayfaya YENIDEN YUKLENIR. Bellekteki her sey (erisim jetonu,
 * profil onbellegi, suren istekler) tek adimda gider; acilistaki yenileme
 * cerezsiz kalir ve sekme oturumsuz acilir.
 *
 * NEDEN uygulama ici gecis degil: oturum silinince korumali sayfa kendi
 * yonlendirmesini (giris ekrani) baslatir ve ana sayfaya giden gecisle
 * yarisir; sonra gelen kazanir (canli testte bulundu).
 *
 * Istek basarisizsa (ag, 503) oturum YERINDE kalir ve hata gosterilir: cerez
 * HttpOnly oldugu icin betik onu silemez; "cikildi" gorunup yenilemede geri
 * gelen bir oturum kullaniciyi yaniltirdi.
 */
export function useLogout() {
  return useMutation({
    mutationFn: () => sessionLock(() => logoutSession(apiClient)),
    onSuccess: () => reloadAt(HOME_PATH),
  });
}
