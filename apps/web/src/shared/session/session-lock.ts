/**
 * Oturum kilidi (T8.5): yenileme jetonunu kullanan ya da degistiren her istek
 * (yenileme, giris, kayit, cikis) BUTUN SEKMELERDE sirayla calisir.
 *
 * NEDEN: yenileme jetonu her kullanimda yenisiyle degisir. Iki sekme ayni anda
 * yenilerse ikincisi eski (kullanilmis) jetonu gonderir; gateway 401 doner ve
 * cerezi SILER, iki sekme birden oturumu kaybeder. Web Locks API'nin kilidi
 * ayni kaynagin butun sekmelerinde tek sahiplidir: ikinci sekme birincinin
 * bitmesini bekler ve tarayicinin cerez kavanozundaki YENI jetonu gonderir.
 * Kilidi tutan sekme kapanirsa tarayici kilidi birakir.
 *
 * navigator.locks yoksa (eski tarayici ya da guvensiz baglam: http ile acilan
 * yerel ag adresi) kilit yalnizca bu sekmede gecerlidir.
 */

export const SESSION_LOCK_NAME = 'getir-oturum';

/** Kilit yoneticisinin kullanilan parcasi; testte sahtesi verilir. */
export interface SessionLockManager {
  request<T>(name: string, task: () => Promise<T>): Promise<T>;
}

/** Isi kilit altinda calistirir; sonucu (ya da hatayi) oldugu gibi dondurur. */
export type SessionLock = <T>(task: () => Promise<T>) => Promise<T>;

export function createSessionLock(locks: SessionLockManager | undefined): SessionLock {
  if (locks !== undefined) {
    return (task) => locks.request(SESSION_LOCK_NAME, task);
  }
  return createTabLock();
}

/** Yalnizca bu sekmede sira: her is bir oncekinin bitmesini (basari ya da hata) bekler. */
function createTabLock(): SessionLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Tarayicinin Web Locks'u; yoksa undefined (bkz. dosya basi). */
export function browserLockManager(): SessionLockManager | undefined {
  if (!('locks' in navigator)) {
    return undefined;
  }
  const { locks } = navigator;
  return {
    async request<T>(name: string, task: () => Promise<T>): Promise<T> {
      // request() geri cagrinin sozunu bekler ve SONUCUNU verir (Web Locks);
      // DOM tipi geri cagri donusunu sarmaladigi icin sonuc burada T'dir.
      const result: T = await locks.request(name, task);
      return result;
    },
  };
}
