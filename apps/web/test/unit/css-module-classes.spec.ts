/**
 * Bilesenin kullandigi her CSS modulu sinifi o modulde TANIMLI olmali (D11).
 *
 * NEDEN TEST: `styles['c-yok']` TypeScript'te hata vermez (modul tipi
 * Record<string, string>); tanimsiz sinif sessizce `undefined` olur ve eleman
 * stilsiz kalir. D11'de iki ornek bulundu (market ozetinin koku, liste adi);
 * ikisi de hicbir stil uygulamiyordu ve fark edilmemisti.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

/** `import styles from './X.module.css'` -> [degisken, modul yolu] */
const MODULE_IMPORT = /import (\w+) from '(\.[\w./-]+\.module\.css)'/g;

function tsxFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => join(SRC, path));
}

/** Modulde tanimli siniflar: yorumlar atilir, her `.ad` secicisi toplanir. */
function definedClasses(css: string): ReadonlySet<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set(
    [...withoutComments.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1] ?? ''),
  );
}

/** Bilesenin modulden okudugu siniflar: `styles['ad']` ve `styles.ad`. */
function usedClasses(source: string, variable: string): string[] {
  const bracket = [...source.matchAll(new RegExp(`${variable}\\['([^']+)'\\]`, 'g'))];
  const dotted = [...source.matchAll(new RegExp(`${variable}\\.([A-Za-z_]\\w*)`, 'g'))];
  return [...bracket, ...dotted].map((match) => match[1] ?? '');
}

interface ModuleUse {
  readonly file: string;
  readonly source: string;
  readonly variable: string;
  readonly cssPath: string;
}

const uses: ModuleUse[] = tsxFiles().flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(MODULE_IMPORT)].map((match) => ({
    file: relative(SRC, file),
    source,
    variable: match[1] ?? '',
    cssPath: join(dirname(file), match[2] ?? ''),
  }));
});

describe('CSS modulu siniflari tanimli (D11)', () => {
  it('tarama bos donmez: bilesenler CSS modulu kullaniyor', () => {
    expect(uses.length).toBeGreaterThan(10);
  });

  it.each(uses.map((use) => [use.file, use] as const))('%s', (_file, use) => {
    const defined = definedClasses(readFileSync(use.cssPath, 'utf8'));

    const missing = usedClasses(use.source, use.variable).filter((name) => !defined.has(name));

    expect(missing).toEqual([]);
  });
});
