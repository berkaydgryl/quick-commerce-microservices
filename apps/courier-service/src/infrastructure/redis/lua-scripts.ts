/**
 * Servisin Lua script'lerini (lua/ klasoru) Redis'e yukler (redis-kit). Bugun
 * yalnizca tick liderligi (leader.lua; inventory'nin kopyasi, ADR-01).
 *
 * Klasor derlenmis koddan da kaynaktan da AYNI goreli yolda: src/infrastructure/
 * redis ve dist/infrastructure/redis -> ../../../lua. Imaja package.json "files"
 * alanindaki "lua" girisiyle girer (scripts/check-node-image.mjs).
 */

import { fileURLToPath } from 'node:url';

import type { Logger } from '@getir/core';
import type { LuaScriptRegistry, RedisConnection } from '@getir/redis-kit';
import { loadLuaScripts } from '@getir/redis-kit';

export const LUA_DIRECTORY = fileURLToPath(new URL('../../../lua/', import.meta.url));

/** Klasordeki script adlari (dosya adi, uzantisiz). */
export const LUA_SCRIPTS = { LEADER: 'leader' } as const;

export function loadCourierScripts(
  redis: RedisConnection['redis'],
  logger: Logger,
): Promise<LuaScriptRegistry> {
  return loadLuaScripts(redis, LUA_DIRECTORY, logger);
}
