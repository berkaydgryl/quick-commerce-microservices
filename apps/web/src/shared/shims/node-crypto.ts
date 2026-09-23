/**
 * Tarayici icin `node:crypto` karsiligi - YALNIZCA vite.config.ts'teki takma ad
 * (alias) uzerinden kullanilir, uygulama kodu bunu import etmez.
 *
 * Sebep: @getir/core kimlik uretimi icin `node:crypto`'dan randomUUID alir;
 * @getir/contracts core'u, web de contracts'i import ettigi icin bu satir
 * tarayici paketine girer ve Vite onu cozemez. Web Crypto'daki randomUUID ayni
 * isi yapar (Node 22'de de global). Kalici cozum core'un globalThis.crypto'ya
 * gecmesidir; o yapildiginda bu dosya ve takma ad silinir.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
