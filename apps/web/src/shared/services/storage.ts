/**
 * Anahtar-deger deposu: tarayicida localStorage, olmadigi yerde bellek.
 *
 * Tip BILEREK dar: yalnizca kullanilan uc islem. Hem DOM `Storage` hem
 * Zustand'in `StateStorage`'i bu bicime uyar; depoyu kullanan kod ikisini de
 * bilmek zorunda kalmaz ve testte bellek ici depo verilir.
 */

export interface KeyValueStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

/** Bellek ici depo: sayfa kapaninca icerik kaybolur. Birim testleri icin. */
export function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/**
 * Tarayicida localStorage. Node'daki birim testlerinde localStorage yoktur;
 * orada bellek ici depo doner ve uygulama kodu kalici yazim olmadan calisir.
 *
 * Fonksiyon olarak verilir, deger olarak degil: tarayici depoya erisimi
 * yasaklamissa (gizlilik ayari) erisim hata firlatir ve bu hata cagiranin
 * (Zustand) yakaladigi yerde olmalidir, modul yuklenirken degil.
 */
export function browserStorage(): KeyValueStorage {
  return typeof localStorage === 'undefined' ? createMemoryStorage() : localStorage;
}
