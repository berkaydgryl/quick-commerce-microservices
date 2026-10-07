import { describe, expect, it } from 'vitest';

import {
  exportedNames,
  isBarrelOutput,
  namespaceOf,
  renderBarrel,
  renderPackageIndex,
} from '../../scripts/barrel-render.mjs';
import type { GeneratedFile } from '../../scripts/barrel-render.mjs';

/**
 * Barrel uretiminin kurali (#135, D18): tek dosyali paket eskisi gibi, cok
 * dosyali pakete package-index.ts ve ts-proto yardimcilarinin acik yeniden disa
 * verilmesi; baska ortak ad hata; cikti deterministik (ayni girdi, bayt bayt
 * ayni cikti).
 */

const HELPER_TYPES = ['MessageFns', 'DeepPartial'];
const file = (path: string, values: string[], types: string[] = []): GeneratedFile => ({
  path,
  values: [...values, 'protobufPackage'],
  types: [...types, ...HELPER_TYPES],
});

const FILES = [
  file('getir/order/v1/order.ts', ['Order', 'OrderServiceClient'], ['Order']),
  file('getir/order/v1/checkout.ts', ['OrderDetails'], ['OrderDetails']),
  file('getir/catalog/v1/catalog.ts', ['Product'], ['Product']),
  file('google/protobuf/timestamp.ts', ['Timestamp'], ['Timestamp']),
];

/** Paket index'inin export satirlari (baslik ve bos satirlar haric). */
function exportLines(contents: string | undefined): string[] {
  return contents?.split('\n').filter((line) => line.startsWith('export')) ?? [];
}

describe('renderBarrel', () => {
  it('tek dosyali paket: dosyanin kendisi ad alani (eski cikti); cok dosyali: package-index.ts', () => {
    const { barrel } = renderBarrel(FILES);

    expect(exportLines(barrel)).toEqual([
      'export * as catalogV1 from "./getir/catalog/v1/catalog.js";',
      'export * as googleProtobuf from "./google/protobuf/timestamp.js";',
      'export * as orderV1 from "./getir/order/v1/package-index.js";',
    ]);
  });

  it('paket index i: dosyalar alfabetik, yardimcilar ilk dosyadan ACIKCA (deger ve tip ayri)', () => {
    const { packageIndexes } = renderBarrel(FILES);

    expect(packageIndexes.map((index) => index.path)).toEqual(['getir/order/v1/package-index.ts']);
    expect(exportLines(packageIndexes[0]?.contents)).toEqual([
      'export * from "./checkout.js";',
      'export * from "./order.js";',
      'export { protobufPackage } from "./checkout.js";',
      'export type { DeepPartial, MessageFns } from "./checkout.js";',
    ]);
  });

  it('deterministik: girdi sirasi ne olursa olsun cikti bayt bayt ayni', () => {
    const reference = renderBarrel(FILES);

    for (const order of [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      const shuffled = order.map((index) => FILES[index] as GeneratedFile);
      expect(renderBarrel(shuffled)).toEqual(reference);
    }
  });

  it('bos girdi: yalnizca baslik, paket index i yok', () => {
    const { barrel, packageIndexes } = renderBarrel([]);

    expect(exportLines(barrel)).toEqual([]);
    expect(barrel).toContain('DO NOT EDIT');
    expect(packageIndexes).toEqual([]);
  });

  it('iki klasor ayni ad alanini uretirse durur; hata girdi sirasindan bagimsiz', () => {
    const a = file('getir/order/v1/order.ts', ['A']);
    const b = file('order/v1/order.ts', ['B']);
    const message =
      'Ad alani cakismasi: "orderV1" hem ./getir/order/v1/order.js hem ./order/v1/order.js tarafindan uretiliyor.';

    expect(() => renderBarrel([a, b])).toThrow(message);
    expect(() => renderBarrel([b, a])).toThrow(message);
  });

  it('kokte (paketsiz) dosya reddedilir', () => {
    expect(() => renderBarrel([file('loose.ts', ['A'])])).toThrow(
      /Paketsiz uretilmis dosya: "loose.ts"/,
    );
    expect(() => renderBarrel([file('/loose.ts', ['A'])])).toThrow(/Paketsiz/);
  });

  it('index.ts adli proto ciktisi paket index iyle cakismaz', () => {
    const { barrel, packageIndexes } = renderBarrel([
      file('getir/shop/v1/index.ts', ['Shop'], ['Shop']),
      file('getir/shop/v1/shelf.ts', ['Shelf'], ['Shelf']),
    ]);

    expect(exportLines(barrel)).toEqual([
      'export * as shopV1 from "./getir/shop/v1/package-index.js";',
    ]);
    expect(exportLines(packageIndexes[0]?.contents).slice(0, 2)).toEqual([
      'export * from "./index.js";',
      'export * from "./shelf.js";',
    ]);
  });
});

describe('renderPackageIndex', () => {
  it('yardimci, onu GERCEKTEN disa veren ilk dosyadan gelir', () => {
    const contents = renderPackageIndex([
      { path: 'getir/x/v1/a.ts', values: ['A', 'protobufPackage'], types: ['A'] },
      { path: 'getir/x/v1/b.ts', values: ['B', 'protobufPackage'], types: ['B', 'DeepPartial'] },
      { path: 'getir/x/v1/c.ts', values: ['C', 'protobufPackage'], types: ['C', 'DeepPartial'] },
    ]);

    expect(exportLines(contents)).toEqual([
      'export * from "./a.js";',
      'export * from "./b.js";',
      'export * from "./c.js";',
      'export { protobufPackage } from "./a.js";',
      'export type { DeepPartial } from "./b.js";',
    ]);
  });

  it('yardimci DISINDA ortak ad (ayni mesaj iki dosyada, eski kalinti) uretimi durdurur', () => {
    expect(() =>
      renderPackageIndex([
        file('getir/x/v1/a.ts', ['Money'], ['Money']),
        file('getir/x/v1/b.ts', ['Money'], ['Money']),
      ]),
    ).toThrow('Ayni ad birden cok dosyada: "Money" (getir/x/v1/a.ts, getir/x/v1/b.ts)');
  });

  it('ikiden az dosya hata (tek dosyali paket index istemez)', () => {
    expect(() => renderPackageIndex([file('getir/x/v1/a.ts', ['A'])])).toThrow(
      "Paket index'i en az iki dosya ister (1 verildi).",
    );
    expect(() => renderPackageIndex([])).toThrow(/en az iki dosya/);
  });
});

describe('isBarrelOutput', () => {
  it('yalniz kendi ciktilari: koktaki barrel ve paket index leri (ikinci kosu kendini okumaz)', () => {
    expect(isBarrelOutput('index.ts')).toBe(true);
    expect(isBarrelOutput('getir/order/v1/package-index.ts')).toBe(true);
    expect(isBarrelOutput('getir/shop/v1/index.ts')).toBe(false);
    expect(isBarrelOutput('getir/order/v1/order.ts')).toBe(false);
  });
});

describe('namespaceOf ve exportedNames', () => {
  it('klasorden ad alani: getir oneki atilir, parcalar camelCase', () => {
    expect(namespaceOf('getir/card_vault/v1')).toBe('card_vaultV1');
    expect(namespaceOf('getir/order/v1')).toBe('orderV1');
    expect(namespaceOf('google/protobuf')).toBe('googleProtobuf');
  });

  it('ts-proto ciktisindan deger ve tip adlari (tekrarsiz, sirali)', () => {
    const source = [
      'export const protobufPackage = "getir.order.v1";',
      'export enum OrderStatus { A = 0 }',
      'export function orderStatusFromJSON(object: any) {}',
      'export interface Order { id: string }',
      'export const Order: MessageFns<Order> = {};',
      'export type DeepPartial<T> = T;',
      '  export const nested = 1;',
    ].join('\n');

    expect(exportedNames(source)).toEqual({
      values: ['Order', 'OrderStatus', 'orderStatusFromJSON', 'protobufPackage'],
      types: ['DeepPartial', 'Order'],
    });
  });

  it('diger bildirim bicimleri: const enum, declare, async ve uretec fonksiyon, let, sinif', () => {
    const source = [
      'export const enum Kind { A }',
      'export declare const declared: number;',
      'export declare interface Shape {}',
      'export async function load() {}',
      'export function* walk() {}',
      'export let counter = 0;',
      'export abstract class Base {}',
      'export class Impl {}',
    ].join('\n');

    expect(exportedNames(source)).toEqual({
      values: ['Base', 'Impl', 'Kind', 'counter', 'declared', 'load', 'walk'],
      types: ['Shape'],
    });
  });
});
