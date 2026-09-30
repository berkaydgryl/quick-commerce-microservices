/**
 * Gercek Redis ile entegrasyon testi (Testcontainers).
 *
 * NEDEN KONTEYNER: Lua script'lerinin davranisi (atomiklik, NOSCRIPT sonrasi
 * yeniden yukleme, EVALSHA donus tipleri) sahte istemciyle DOGRULANAMAZ.
 * Projenin en degerli parcasi stok motoru ve o parca tamamen Redis'in
 * davranisina dayaniyor; bu yuzden testi de gercek Redis'e dayaniyor.
 */

import { fileURLToPath } from 'node:url';

import { AppError, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectRedis } from '../../src/client.js';
import type { RedisConnection } from '../../src/client.js';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '../../src/keys.js';
import { loadLuaScripts } from '../../src/scripts/registry.js';
import type { LuaScriptRegistry } from '../../src/scripts/registry.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';

const LUA_DIR = fileURLToPath(new URL('./lua', import.meta.url));

const STORE = 'ds_kadikoy';
const SKU = 'SUT-1L';

let container: StartedRedisContainer;
let connection: RedisConnection;
let scripts: LuaScriptRegistry;

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  connection = await connectRedis({ url: container.getConnectionUrl(), name: 'redis-kit-test' });
  scripts = await loadLuaScripts(connection.redis, LUA_DIR);
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('connectRedis', () => {
  it('baglanir ve ping doner', async () => {
    await expect(connection.ping()).resolves.toBe(true);
  });

  it('kapanista kendi ekledigi dinleyicileri birakir', async () => {
    // Ayri bir baglanti: paylasilan baglantiyi kapatmadan olcum yapabilmek icin.
    const short = await connectRedis({ url: container.getConnectionUrl() });
    expect(short.redis.listenerCount('error')).toBeGreaterThan(0);

    await short.close();

    // Dinleyici birakmak, uzun omurlu proceslerde sessiz bir sizintidir.
    expect(short.redis.listenerCount('error')).toBe(0);
    expect(short.redis.listenerCount('reconnecting')).toBe(0);
  });

  it('ulasilamayan adrese baglanmayi AppError ile bildirir', async () => {
    // Kapali bir port: surucu kendi hata tipini firlatmamali, AppError gelmeli.
    await expect(
      connectRedis({ url: 'redis://127.0.0.1:1', connectTimeoutMs: 500 }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('ilk baglanti denemelerindeki hatalar warn yazilir, error DEGIL', async () => {
    // Redis servisle ayni anda ayaga kalkiyor olabilir: butce icindeki hata
    // beklenen durumdur. Kalici basarisizligi cagiran (startOrExit) fatal yazar.
    const levels: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn: () => {
        levels.push('warn');
      },
      error: () => {
        levels.push('error');
      },
      child: () => logger,
    };

    await connectRedis({ url: 'redis://127.0.0.1:1', connectTimeoutMs: 500, logger }).catch(
      () => undefined,
    );

    expect(levels).toContain('warn');
    expect(levels).not.toContain('error');
  });
});

describe('anahtar ureticileri gercek Redis uzerinde', () => {
  it('uretilen anahtarlar yazilip okunabiliyor', async () => {
    const availKey = stockAvailKey(STORE, SKU);
    await connection.redis.set(availKey, '5');

    await expect(connection.redis.get(availKey)).resolves.toBe('5');
  });

  it('bir depoya ait anahtarlar tek KEYS kumesinde kullanilabiliyor', async () => {
    const keys = [
      stockAvailKey(STORE, SKU),
      reservationKey(STORE, 'ord_9'),
      reservationIndexKey(STORE),
    ];

    await expect(scripts.get('count-keys').run(keys)).resolves.toBe(keys.length);
  });
});

describe('Lua yukleyici', () => {
  it("klasordeki tum script'leri yukler", () => {
    expect(scripts.names).toEqual(['count-keys', 'decr-if-enough']);
  });

  it('yuklenmemis script adi AppError verir', () => {
    expect(() => scripts.get('yok')).toThrow(AppError);
  });

  it('kontrol ve dusum tek atomik adimda yapilir', async () => {
    const availKey = stockAvailKey(STORE, 'EKMEK-1');
    await connection.redis.set(availKey, '10');

    await expect(scripts.get('decr-if-enough').run([availKey], [4])).resolves.toEqual([1, 6]);
    await expect(connection.redis.get(availKey)).resolves.toBe('6');
  });

  it('stok yetmiyorsa hicbir sey yazmaz', async () => {
    const availKey = stockAvailKey(STORE, 'YUMURTA-10');
    await connection.redis.set(availKey, '2');

    await expect(scripts.get('decr-if-enough').run([availKey], [3])).resolves.toEqual([0, 2]);
    // Sayac DOKUNULMAMIS olmali: kismi dusum yok.
    await expect(connection.redis.get(availKey)).resolves.toBe('2');
  });

  it('es zamanli 20 istekte stok 1 ise tam 1 tanesi basarili olur', async () => {
    const availKey = stockAvailKey(STORE, 'SON-KUTU');
    await connection.redis.set(availKey, '1');

    const attempts = Array.from({ length: 20 }, () =>
      scripts.get('decr-if-enough').run([availKey], [1]),
    );
    const results = (await Promise.all(attempts)) as [number, number][];

    expect(results.filter(([ok]) => ok === 1)).toHaveLength(1);
    await expect(connection.redis.get(availKey)).resolves.toBe('0');
  });

  it('SCRIPT FLUSH sonrasi kendini toparlar (NOSCRIPT)', async () => {
    const availKey = stockAvailKey(STORE, 'CAY-500');
    await connection.redis.set(availKey, '3');

    // Redis yeniden baslamis gibi: yuklu script'lerin tamami silinir.
    await connection.redis.script('FLUSH');

    await expect(scripts.get('decr-if-enough').run([availKey], [1])).resolves.toEqual([1, 2]);
  });
});

describe("farkli hash-tag'lere dokunan script (T10.1)", () => {
  // Stok anahtari {ds_kadikoy}, kullanici kilidi {usr_1}: iki ayri slot.
  const crossKeys = [stockAvailKey(STORE, SKU), userReservationKey('usr_1')];
  const warnings = (lines: readonly LogLine[]) => lines.filter((line) => line.level === 'warn');

  it('beyan edilmeyen script her cagrida uyari yazar', async () => {
    const lines: LogLine[] = [];
    const registry = await loadLuaScripts(connection.redis, LUA_DIR, recordingLogger(lines));

    await registry.get('count-keys').run(crossKeys);
    await registry.get('count-keys').run(crossKeys);

    expect(warnings(lines)).toHaveLength(2);
  });

  it('crossSlot ile beyan edilen script uyarmaz; yuklemede bir kez bilgi satiri yazilir', async () => {
    const lines: LogLine[] = [];
    const registry = await loadLuaScripts(connection.redis, LUA_DIR, recordingLogger(lines), {
      crossSlot: ['count-keys'],
    });

    await expect(registry.get('count-keys').run(crossKeys)).resolves.toBe(2);
    await registry.get('count-keys').run(crossKeys);

    expect(warnings(lines)).toEqual([]);
    expect(
      lines.filter((line) => line.level === 'info' && line.fields['script'] === 'count-keys'),
    ).toHaveLength(1);
  });

  it('beyan edilen ad klasorde yoksa acilista AppError (yazim hatasi sessiz kalmaz)', async () => {
    await expect(
      loadLuaScripts(connection.redis, LUA_DIR, silentLogger, { crossSlot: ['resrve'] }),
    ).rejects.toThrow(AppError);
  });
});
