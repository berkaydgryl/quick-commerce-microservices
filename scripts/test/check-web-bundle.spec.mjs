/**
 * Web paket taramasi (T8.5): aranan degerler persona dosyasindan gelir, kacisli
 * yazim da yakalanir, bos paket temiz sayilmaz.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkBundle,
  findLeaks,
  PERSONAS_FILE,
  personaNeedles,
  spellings,
} from '../check-web-bundle.mjs';

const PERSONAS = {
  password: 'Demo-Persona-2026',
  accounts: [
    {
      persona: 'Ayşe',
      id: 'usr_a9e0eddcc7fe5bf4c620ae453c227c6a',
      phone: '+905550000001',
      fullName: 'Ayşe Yılmaz',
    },
  ],
};

const dirs = [];

function bundleWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'web-paket-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('personaNeedles', () => {
  it('sifre, kimlik, iki telefon bicimi ve ad soyad aranir', () => {
    expect(personaNeedles(PERSONAS).map(({ needle }) => needle)).toEqual([
      'Demo-Persona-2026',
      'usr_a9e0eddcc7fe5bf4c620ae453c227c6a',
      '+905550000001',
      'Ayşe Yılmaz',
      '5550000001',
    ]);
  });

  it('gercek persona dosyasi okunur: her hesap icin dort deger + sifre', () => {
    const personas = JSON.parse(readFileSync(PERSONAS_FILE, 'utf8'));

    expect(personaNeedles(personas)).toHaveLength(1 + personas.accounts.length * 4);
  });

  it('bicimsiz persona dosyasi sessizce bos liste olmaz', () => {
    expect(() => personaNeedles({ accounts: [] })).toThrow(/beklenen bicimde/);
    expect(() => personaNeedles({ password: 'x', accounts: [{ persona: 'A' }] })).toThrow(
      /A: id alani eksik/,
    );
  });
});

describe('spellings', () => {
  it('ASCII disi harfin JS kacisli yazimini da uretir', () => {
    expect(spellings('Ayşe')).toEqual(['Ayşe', 'Ay\\u015fe', 'Ay\\u015Fe']);
    expect(spellings('Demo')).toEqual(['Demo']);
  });
});

describe('findLeaks', () => {
  const needles = personaNeedles(PERSONAS);

  it('kacisli yazilmis ad da yakalanir', () => {
    const leaks = findLeaks(
      [{ path: 'assets/i.js', content: 'x="Ay\\u015fe Y\\u0131lmaz"' }],
      needles,
    );

    expect(leaks).toEqual(['assets/i.js: Ayşe fullName']);
  });

  it('ulusal bicimli telefon da yakalanir', () => {
    expect(findLeaks([{ path: 'a.js', content: 'p="5550000001"' }], needles)).toEqual([
      'a.js: Ayşe ulusal telefon',
    ]);
  });
});

describe('checkBundle', () => {
  it('temiz paket gecer', () => {
    const dir = bundleWith({ 'index.html': '<div id="root"></div>', 'assets/i.js': 'x=1' });

    expect(checkBundle(dir, PERSONAS)).toEqual({
      ok: true,
      lines: ['paket temiz: 2 dosya, 5 persona degeri arandi'],
    });
  });

  it('sifre sizan paket kalir ve dosya adiyla raporlanir', () => {
    const dir = bundleWith({ 'assets/i.js': 'const p="Demo-Persona-2026"' });

    const result = checkBundle(dir, PERSONAS);

    expect(result.ok).toBe(false);
    expect(result.lines).toContain('  - assets/i.js: demo sifresi');
  });

  it('bos ya da olmayan paket temiz sayilmaz', () => {
    expect(checkBundle(bundleWith({}), PERSONAS).ok).toBe(false);
    expect(checkBundle(join(tmpdir(), 'olmayan-web-paketi'), PERSONAS).ok).toBe(false);
  });
});
