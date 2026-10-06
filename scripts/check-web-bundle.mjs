#!/usr/bin/env node
/**
 * Web production paketi taramasi (T8.5) - CI'in "Paket taramasi" adimi ve `pnpm verify`
 * calistirir.
 *
 *   node scripts/check-web-bundle.mjs [paket-klasoru]
 *   varsayilan: apps/web/dist (once `pnpm build`)
 *
 * Neye bakar: demo personalarinin bilgisi (ortak demo sifresi, telefonlar, kullanici
 * kimlikleri, ad soyadlar) production paketinde GECMEZ. Aranan degerler gateway'in
 * persona dosyasindan (apps/gateway/internal/persona/personas.json) okunur; betik bir
 * liste kopyalamaz. Telefon hem E.164 ("+905550000001") hem ulusal ("5550000001")
 * bicimiyle, Turkce harfli ad hem duz hem de JS kacisli ("Ayşe") yazimiyla aranir:
 * esbuild ASCII disi harfi kacisli yazabilir.
 *
 * NEDEN: persona secici yalnizca gelistirme paketine girer (vite.config.ts
 * __DEMO_PERSONAS__). Bayrak yanlis kurulursa ya da bir dosya persona verisini
 * dogrudan import ederse bilinen sifreli hesaplar herkese acik pakete sizar; bu,
 * derlemeden sonra ancak paketin kendisine bakilarak gorulur.
 *
 * T11.17'den beri production'da KAPALI ozellikler de aranir (GATED_NEEDLES):
 * Odeme Yontemlerim (__CARD_VAULT__) yalnizca gelistirme paketinde derlenir;
 * kart kasasinin ucu ve sayfanin adresi production paketinde gecmemeli.
 *
 * Bos ya da eksik paket BASARISIZDIR: taranacak dosya yoksa "temiz" denmez.
 * Bagimliliksiz duz Node.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_DIST_DIR = join(ROOT, 'apps/web/dist');
export const PERSONAS_FILE = join(ROOT, 'apps/gateway/internal/persona/personas.json');

/** Taranan metin dosyalari; gorseller (png, svg disi ikili) taranmaz. */
const TEXT_FILE = /\.(?:js|mjs|css|html|json|map|txt|svg)$/;

/**
 * Persona dosyasindan aranacak degerler: her deger icin neden arandigi.
 * @param {unknown} personas - personas.json icerigi
 * @returns {Array<{ needle: string, label: string }>}
 */
export function personaNeedles(personas) {
  if (
    typeof personas !== 'object' ||
    personas === null ||
    typeof personas.password !== 'string' ||
    !Array.isArray(personas.accounts)
  ) {
    throw new Error('persona dosyasi beklenen bicimde degil: { password, accounts[] }');
  }
  const needles = [{ needle: personas.password, label: 'demo sifresi' }];
  for (const account of personas.accounts) {
    const name = String(account.persona);
    for (const [field, value] of [
      ['id', account.id],
      ['phone', account.phone],
      ['fullName', account.fullName],
    ]) {
      if (typeof value !== 'string' || value === '') {
        throw new Error(`${name}: ${field} alani eksik`);
      }
      needles.push({ needle: value, label: `${name} ${field}` });
    }
    needles.push({ needle: account.phone.replace(/^\+90/, ''), label: `${name} ulusal telefon` });
  }
  return needles;
}

/**
 * Degerin pakette gecebilecegi yazimlari: kendisi ve ASCII disi harflerin JS kacisi
 * (kucuk ve buyuk harfli onaltilik).
 * @param {string} value
 * @returns {string[]}
 */
export function spellings(value) {
  const escape = (upper) =>
    [...value]
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x80) {
          return char;
        }
        const hex = code.toString(16).padStart(4, '0');
        return `\\u${upper ? hex.toUpperCase() : hex}`;
      })
      .join('');
  return [...new Set([value, escape(false), escape(true)])];
}

/**
 * Paketteki metin dosyalari (klasore gore goreli yol ve icerik).
 * @param {string} distDir
 * @returns {Array<{ path: string, content: string }>}
 */
export function readBundle(distDir) {
  let entries;
  try {
    entries = readdirSync(distDir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return entries
    .map((entry) => join(distDir, entry))
    .filter((path) => TEXT_FILE.test(path) && statSync(path).isFile())
    .map((path) => ({ path: relative(distDir, path), content: readFileSync(path, 'utf8') }));
}

/**
 * Paketteki persona izleri; bossa temiz.
 * @param {Array<{ path: string, content: string }>} files
 * @param {Array<{ needle: string, label: string }>} needles
 * @returns {string[]}
 */
export function findLeaks(files, needles) {
  const leaks = [];
  for (const { needle, label } of needles) {
    for (const file of files) {
      if (spellings(needle).some((spelling) => file.content.includes(spelling))) {
        leaks.push(`${file.path}: ${label}`);
      }
    }
  }
  return leaks;
}

/**
 * Production'da kapali ozelliklerin izleri (derleme bayragi false). Bayrak
 * yanlis kurulursa ya da bir dosya ozelligi bayraksiz import ederse kapali
 * sayfa ve ucu herkese acik pakete girer. Ozellik production'da acilinca
 * satiri buradan silinir.
 */
export const GATED_NEEDLES = [
  { needle: '/v1/me/cards', label: 'kart kasasi ucu (T11.17, __CARD_VAULT__)' },
  { needle: 'odeme-yontemlerim', label: 'Odeme Yontemlerim adresi (T11.17, __CARD_VAULT__)' },
];

/**
 * @param {string} distDir
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkBundle(distDir, personas) {
  const files = readBundle(distDir);
  if (!files.some((file) => file.path.endsWith('.js'))) {
    return {
      ok: false,
      lines: [`paket bulunamadi ya da bos: ${distDir} (once pnpm build)`],
    };
  }
  const needles = personaNeedles(personas);
  const leaks = findLeaks(files, [...needles, ...GATED_NEEDLES]);
  if (leaks.length > 0) {
    return {
      ok: false,
      lines: [
        'production paketinde olmamasi gereken deger var:',
        ...leaks.map((leak) => `  - ${leak}`),
        'persona secici ve kapali ozellikler yalnizca gelistirmede derlenir (vite.config.ts define).',
      ],
    };
  }
  return {
    ok: true,
    lines: [
      `paket temiz: ${files.length} dosya, ${needles.length} persona degeri ve ${GATED_NEEDLES.length} kapali ozellik izi arandi`,
    ],
  };
}

function main(argv) {
  const distDir = argv[0] ?? DEFAULT_DIST_DIR;
  const personas = JSON.parse(readFileSync(PERSONAS_FILE, 'utf8'));
  const { ok, lines } = checkBundle(distDir, personas);
  for (const line of lines) {
    (ok ? console.log : console.error)(line);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
