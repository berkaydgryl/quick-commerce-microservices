/**
 * Gercek Redis ile entegrasyon testi (Testcontainers).
 *
 * NEDEN KONTEYNER: Lua script'lerinin davranisi (atomiklik, NOSCRIPT sonrasi
 * yeniden yukleme, EVALSHA donus tipleri) sahte istemciyle DOGRULANAMAZ.
 * Projenin en degerli parcasi stok motoru ve o parca tamamen Redis'in
 * davranisina dayaniyor; bu yuzden testi de gercek Redis'e dayaniyor.
 */

import { fileURLToPath } from 'node:url';

import { AppError } from '@getir/core';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectRedis } from '../../src/client.js';
import type { RedisConnection } from '../../src/client.js';
import { reservationIndexKey, reservationKey, stockAvailKey } from '../../src/keys.js';
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
