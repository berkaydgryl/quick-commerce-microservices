/**
 * Lua kaynaklarini DISKTEN okur. Redis'i tanimaz.
 *
 * Ayri modul olmasinin sebebi tek sorumluluk: burasi yalnizca dosya sistemini
 * bilir, registry.ts yalnizca Redis'i. Boylece "klasorde ne var, dosya adi
 * script adina nasil donusuyor" sorulari baglanti olmadan test edilir.
 *
 * NEDEN .lua DOSYASI, KOD ICINDE STRING DEGIL: sozdizimi vurgulanir,
 * `redis-cli --eval` ile elle denenebilir ve script'in tarihcesi git'te ayri
 * bir dosya olarak okunur (ADR-01).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { AppError } from '@getir/core';

/** Diskten okunmus, henuz Redis'e yuklenmemis script. */
export interface LuaSource {
  /** Dosya adi (uzantisiz): reserve.lua -> "reserve". */
  readonly name: string;
  readonly source: string;
}

const LUA_EXTENSION = '.lua';

/**
 * Klasordeki .lua dosyalarini alfabetik sirayla okur.
 * Klasor bos ya da yoksa acikca hata verir: sessizce bos liste dondurmek,
 * "script neden calismiyor" sorusunu calisma zamanina erteler.
 */
export function readLuaDirectory(directory: string): readonly LuaSource[] {
  const sources = readdirSync(directory)
    .filter((file) => extname(file) === LUA_EXTENSION)
    .sort()
    .map((file) => ({
      name: basename(file, LUA_EXTENSION),
      source: readFileSync(join(directory, file), 'utf8'),
    }));

  if (sources.length === 0) {
    throw AppError.internal(`Lua klasorunde script yok: ${directory}`);
  }
  return sources;
}
