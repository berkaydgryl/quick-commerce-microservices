/**
 * Lua script'lerini REDIS'E yukler ve calistirir. Dosya sistemini tanimaz;
 * kaynaklari source.ts'ten alir.
 *
 * NASIL CALISIR: acilista her script SCRIPT LOAD ile yuklenir ve SHA'si
 * saklanir; cagrilar EVALSHA ile gider (script govdesi her cagrida tel
 * uzerinden gitmez). Redis yeniden baslar ya da SCRIPT FLUSH calisirsa SHA
 * kaybolur ve EVALSHA "NOSCRIPT" doner. Bu durum YENIDEN YUKLEME ile sessizce
 * toparlanir; servisin haberi olmaz, geriye bir uyari gunlugu kalir.
 *
 * NEDEN ioredis'in defineCommand'i degil: defineCommand ayni isi yapar ama
 * script'i istemci nesnesine dinamik bir metot olarak ekler; tip tarafinda
 * modul genisletme (declaration merging) gerekir ve `any` ile calismaya iter.
 * Burada script'ler adi ve SHA'si acikca gorunen tipli nesneler olarak duruyor.
 */

import { AppError, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import type { Redis } from 'ioredis';

import { sameHashTag } from '../keys.js';
import { readLuaDirectory } from './source.js';

/** Script cagrisinda gecilebilecek argumanlar. */
export type LuaArgument = string | number;

export interface LuaScript {
  /** Dosya adi (uzantisiz): reserve.lua -> "reserve". */
  readonly name: string;
  /** SCRIPT LOAD ciktisi; NOSCRIPT sonrasi yeniden yuklemede degisebilir. */
  readonly sha: string;
  /** Script'i calistirir. Donen deger Redis'in verdigi ham degerdir. */
  run(keys: readonly string[], args?: readonly LuaArgument[]): Promise<unknown>;
}

export interface LuaScriptRegistry {
  /** Yuklenmis script'i ada gore verir; yoksa AppError firlatir. */
  get(name: string): LuaScript;
  /** Yuklenmis script adlari (alfabetik). */
  readonly names: readonly string[];
}

/** Redis'in yuklu olmayan SHA icin dondurdugu hata isareti. */
const NOSCRIPT_MARKER = 'NOSCRIPT';

/**
 * Klasordeki tum .lua dosyalarini Redis'e yukler.
 *
 * @param redis Acik baglanti.
 * @param directory Mutlak klasor yolu (servis kendi `lua/` klasorunu verir).
 */
export async function loadLuaScripts(
  redis: Redis,
  directory: string,
  logger: Logger = silentLogger,
): Promise<LuaScriptRegistry> {
  const scripts = new Map<string, LuaScript>();

  for (const { name, source } of readLuaDirectory(directory)) {
    scripts.set(name, await register(redis, name, source, logger));
  }

  logger.info({ directory, count: scripts.size }, 'lua script yuklendi');

  return {
    names: [...scripts.keys()],
    get: (name: string): LuaScript => {
      const script = scripts.get(name);
      if (script === undefined) {
        throw AppError.internal(`Yuklenmemis Lua script: ${name}`, {
          details: { name, loaded: [...scripts.keys()] },
        });
      }
      return script;
    },
  };
}

async function register(
  redis: Redis,
  name: string,
  source: string,
  logger: Logger,
): Promise<LuaScript> {
  let sha = await load(redis, source);

  const script: LuaScript = {
    name,
    get sha() {
      return sha;
    },
    run: async (keys: readonly string[], args: readonly LuaArgument[] = []): Promise<unknown> => {
      // Cluster kurali: tek script'in dokundugu anahtarlar ayni slot'ta olmali.
      // Tek dugumde calistigi icin ENGELLEMIYORUZ, yalnizca gorunur kiliyoruz.
      if (!sameHashTag(keys)) {
        logger.warn({ script: name, keys }, "script farkli hash-tag'lere dokunuyor");
      }

      try {
        return await redis.evalsha(sha, keys.length, ...keys, ...args.map(String));
      } catch (error: unknown) {
        if (!isNoScriptError(error)) {
          throw AppError.internal(`Lua script hata verdi: ${name}`, { cause: error });
        }
        // Redis yeniden basladi ya da SCRIPT FLUSH calisti: tekrar yukle ve bir
        // kez daha dene. Ikinci hata artik gercek bir hatadir, yutulmaz.
        logger.warn({ script: name }, 'script Redis tarafinda yok, yeniden yukleniyor');
        sha = await load(redis, source);
        return await redis.evalsha(sha, keys.length, ...keys, ...args.map(String));
      }
    },
  };

  return script;
}

async function load(redis: Redis, source: string): Promise<string> {
  const sha: unknown = await redis.script('LOAD', source);
  if (typeof sha !== 'string') {
    throw AppError.internal('SCRIPT LOAD beklenen SHA degerini dondurmedi');
  }
  return sha;
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NOSCRIPT_MARKER);
}
