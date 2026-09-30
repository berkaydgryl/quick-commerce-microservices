/**
 * Servisin Lua script'lerini (lua/ klasoru) Redis'e yukler (redis-kit).
 *
 * Klasor derlenmis koddan da kaynaktan da AYNI goreli yolda: src/infrastructure/
 * redis ve dist/infrastructure/redis -> ../../../lua. Imaja package.json "files"
 * alanindaki "lua" girisiyle girer (Dockerfile, scripts/check-node-image.mjs).
 */

import { fileURLToPath } from 'node:url';

import type { Logger } from '@getir/core';
import type { LuaScriptRegistry, RedisConnection } from '@getir/redis-kit';
import { loadLuaScripts } from '@getir/redis-kit';

import { LUA_SCRIPTS } from '../../config/constants.js';

export const LUA_DIRECTORY = fileURLToPath(new URL('../../../lua/', import.meta.url));

export function loadInventoryScripts(
  redis: RedisConnection['redis'],
  logger: Logger,
): Promise<LuaScriptRegistry> {
  // reserve ve release kullanici kilidine de dokunur (resv:user:{userId}): stok
  // anahtarlarindan ayri slot, bilincli (T10.1 karari; redis-kit keys.ts userReservationKey).
  return loadLuaScripts(redis, LUA_DIRECTORY, logger, {
    crossSlot: [LUA_SCRIPTS.RESERVE, LUA_SCRIPTS.RELEASE],
  });
}
