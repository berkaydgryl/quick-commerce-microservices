import { fileURLToPath } from 'node:url';

import { AppError } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { readLuaDirectory } from '../../src/scripts/source.js';

/** Entegrasyon testlerinin kullandigi ornek script klasoru. */
const LUA_DIR = fileURLToPath(new URL('../integration/lua', import.meta.url));

describe('readLuaDirectory', () => {
  it('klasordeki .lua dosyalarini alfabetik okur', () => {
    const sources = readLuaDirectory(LUA_DIR);

    expect(sources.map((source) => source.name)).toEqual(['count-keys', 'decr-if-enough']);
    expect(sources[0]?.source).toContain('return #KEYS');
  });

  it('bos ya da olmayan klasorde acikca hata verir', () => {
    // Sessizce bos kayit dondurmek, "script neden calismiyor" sorusunu
    // calisma zamanina erteler; burada durmak daha ucuz.
    expect(() => readLuaDirectory(fileURLToPath(new URL('.', import.meta.url)))).toThrow(AppError);
  });
});
