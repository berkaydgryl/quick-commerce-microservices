// gen/ts/index.ts dosyasini uretir: paketin tek giris noktasi.
//
// NEDEN ELLE YAZILMIYOR: index dosyasi .proto listesini birebir izlemek zorunda.
// Elle tutulsaydi yeni bir proto eklendiginde unutulur ve eksiklik ancak baska bir
// serviste "export yok" hatasi olarak ortaya cikardi.
//
// NEDEN ts-proto'nun "outputIndex=true" secenegi KULLANILMIYOR: o secenek her proto
// paketi icin ayri bir index uretir (index.getir.catalog.v1.ts, index.getir.catalog.ts,
// ...) ve ust seviyelerde ayni dosya adini iki kez uretip buf'ta
// "duplicate generated file name" uyarisi verir. Tek ve duz bir giris noktasi istiyoruz.
//
// NEDEN DUZ "export *" DEGIL, AD ALANI: her uretilen dosya "protobufPackage" adli bir
// sabit disari verir. Duz "export *" ile yedi dosyanin yedisi ayni adi verir ve
// derleme cakisma yuzunden kirilir. Ayrica Money/GeoPoint gibi tipler birden cok
// dosyadan yeniden disari verilebilir. "export * as commonV1" bu sinifin tamamini
// kokten cozer ve cagri yerinde hangi sozlesmeden geldigi okunur olur:
//     import { catalogV1 } from '@getir/proto';
//     const client = new catalogV1.CatalogServiceClient(...);
//
// COK DOSYALI PAKET (#135, D18): bir proto paketi (klasor) birden cok .proto
// tasiyabilir; o klasore package-index.ts yazilir ve ad alani ondan verilir. Kural
// ve uretim barrel-render.mjs'tedir (saf, test edilir); burasi yalnizca okur ve
// yazar. Disa verilen adlar yalnizca cok dosyali paketlerde okunur (ortak ad
// cozumu icin); tek dosyali paket "export * as" ile oldugu gibi verilir.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BARREL_FILE,
  directoryOf,
  exportedNames,
  isBarrelOutput,
  renderBarrel,
} from './barrel-render.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GEN_TS_DIR = join(PACKAGE_ROOT, 'gen', 'ts');

/**
 * Uretilen .ts dosyalari (gen/ts'e goreli, ileri bolulu yollar). Bu betigin
 * ciktilari girdiye alinmaz (isBarrelOutput).
 * @param {string} directory
 * @returns {string[]}
 */
function collectGeneratedFiles(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    const path = relative(GEN_TS_DIR, fullPath).split(sep).join('/');
    if (entry.isDirectory()) {
      found.push(...collectGeneratedFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !isBarrelOutput(path)) {
      found.push(path);
    }
  }
  return found;
}

const paths = collectGeneratedFiles(GEN_TS_DIR);
/** @type {Map<string, number>} */
const filesPerDirectory = new Map();
for (const path of paths) {
  const directory = directoryOf(path);
  filesPerDirectory.set(directory, (filesPerDirectory.get(directory) ?? 0) + 1);
}
const files = paths.map((path) =>
  (filesPerDirectory.get(directoryOf(path)) ?? 0) > 1
    ? { path, ...exportedNames(readFileSync(join(GEN_TS_DIR, ...path.split('/')), 'utf8')) }
    : { path, values: [], types: [] },
);

const { barrel, packageIndexes } = renderBarrel(files);
for (const { path, contents } of packageIndexes) {
  writeFileSync(join(GEN_TS_DIR, ...path.split('/')), contents, 'utf8');
}
writeFileSync(join(GEN_TS_DIR, BARREL_FILE), barrel, 'utf8');
console.log(
  `gen/ts/index.ts yazildi (${files.length} dosya, ${packageIndexes.length} cok dosyali paket).`,
);
