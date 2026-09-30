/**
 * Lua script'leri calisma aninda DISKTEN okunur (redis-kit): klasor servisle
 * birlikte imaja girmeli. pnpm deploy servisin kendi dosyalarindan yalnizca
 * package.json "files" alanini kopyalar (Dockerfile, D12); "lua" orada yoksa
 * servis imajda acilirken durur.
 */

import { readFileSync } from 'node:fs';

import { readLuaDirectory } from '@getir/redis-kit';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { LUA_SCRIPTS } from '../../src/config/constants.js';
import { LUA_DIRECTORY } from '../../src/infrastructure/redis/lua-scripts.js';

const packageJson = z
  .object({ files: z.array(z.string()) })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

describe('Lua script klasoru', () => {
  it('kodun bekledigi her script klasorde', () => {
    const names = readLuaDirectory(LUA_DIRECTORY).map((source) => source.name);

    expect(names).toEqual(expect.arrayContaining(Object.values(LUA_SCRIPTS)));
  });

  it('klasor imaja girer: package.json "files" icinde', () => {
    expect(packageJson.files).toContain('lua');
  });
});
