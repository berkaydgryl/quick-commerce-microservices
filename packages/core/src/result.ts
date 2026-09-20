/**
 * Result<T, E> - ayristirilmis birlesim (discriminated union) ile hata tasima.
 *
 * Neden: beklenen is kurali hatalari (stok yetersiz, kupon gecersiz) exception
 * ile degil, deger olarak tasinir. Exception sadece beklenmeyen durumlar icindir.
 *
 * Bu dosyadaki her sey saf fonksiyondur: I/O yok, global durum yok, mutasyon yok.
 */

/** Basarili sonuc. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Basarisiz sonuc. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Ya basari (value) ya da hata (error) tasir; ikisi ayni anda olamaz. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Basarili sonuc uretir. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Basarisiz sonuc uretir. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Tip daraltan basari kontrolu. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Tip daraltan hata kontrolu. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Hata durumunda verilen varsayilani dondurur. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Bir Result'tan basari / hata tipini cikaran yardimci tipler.
 *
 * NEDEN BUNLAR VAR: `map(result, fn)` imzasi dogrudan `Result<T, E>` alsaydi,
 * TypeScript birlesimden birlesime cikarim yaparken T ve E'yi cozemez ve
 * cagiran taraf `value is of type 'unknown'` hatasi alirdi:
 *
 *   const r: Result<number, string> = err('bozuk');
 *   map(r, (value) => value * 2);   // T = unknown olurdu
 *
 * Bunun yerine tek bir R generic'i cikarilir (birlesimin kendisi), sonra
 * kosullu tipler dagitilarak T ve E elde edilir. Boylece degisken uzerinden
 * cagri da, dogrudan ok()/err() ile cagri da tip guvenli kalir.
 */
export type ResultValue<R> = R extends Ok<infer T> ? T : never;
export type ResultError<R> = R extends Err<infer E> ? E : never;

/** Herhangi bir Result; generic siniri olarak kullanilir. */
export type AnyResult = Result<unknown, unknown>;

/** Basari degerini donusturur; hata oldugu gibi gecer. */
export function map<R extends AnyResult, U>(
  result: R,
  fn: (value: ResultValue<R>) => U,
): Result<U, ResultError<R>> {
  return result.ok ? ok(fn(result.value as ResultValue<R>)) : (result as Err<ResultError<R>>);
}

/** Hata degerini donusturur; basari oldugu gibi gecer. */
export function mapErr<R extends AnyResult, F>(
  result: R,
  fn: (error: ResultError<R>) => F,
): Result<ResultValue<R>, F> {
  return result.ok ? (result as Ok<ResultValue<R>>) : err(fn(result.error as ResultError<R>));
}
