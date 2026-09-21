import { describe, expect, it } from 'vitest';

import { catalogV1, commonV1, inventoryV1, orderV1 } from '../../gen/ts/index.js';

/**
 * Bu dosya ELLE YAZILMIS KOD test etmez; T2.3'un kapisidir: ".proto dosyalarindan
 * uretilen TypeScript gercekten CALISIYOR mu?"
 *
 * Tip denetimi (pnpm typecheck) tek basina yetmez, cunku buradaki risklerin cogu
 * calisma zamaninda ortaya cikar: ESM altinda CommonJS bir paketi yanlis bicimde
 * import etmek derlemede degil, ilk "new" cagrisinda patlar. Bu yuzden testler
 * uretilen kodu gercekten YUKLER ve CALISTIRIR.
 *
 * Testler .proto icerigine degil, URETIM AYARLARINA bakar (buf.gen.ts.yaml).
 * Yani bir RPC eklenince bu dosya degismez; bir uretim secenegi bozulursa kirilir.
 */

describe('uretilen TypeScript - modul yuklenmesi', () => {
  it('barrel her proto paketini ad alani olarak disari verir', () => {
    // gen/ts/index.ts scripts/write-barrel.mjs tarafindan uretilir. Bir .proto
    // dosyasi eklenip barrel yenilenmezse burasi kirilir.
    expect(Object.keys(commonV1)).toContain('Money');
    expect(Object.keys(catalogV1)).toContain('CatalogServiceClient');
  });

  it('ayni tip iki ayri ad alanindan cakismadan gorunur', () => {
    // "export * as ..." secilmesinin sebebi: her uretilen dosya "protobufPackage"
    // adli bir sabit disari verir. Duz "export *" olsaydi yedi dosya ayni adi
    // verir ve paket hic derlenmezdi.
    expect(commonV1.protobufPackage).toBe('getir.common.v1');
    expect(catalogV1.protobufPackage).toBe('getir.catalog.v1');
    expect(orderV1.protobufPackage).toBe('getir.order.v1');
  });
});

describe('uretilen TypeScript - gRPC istemcileri (esModuleInterop)', () => {
  it('istemci sinifi ESM altinda cagrilabilir bir yapicidir', () => {
    // ASIL SINAV BURASI. @grpc/grpc-js bir CommonJS paketidir; buf.gen.ts.yaml
    // icindeki "esModuleInterop=true" olmasaydi ts-proto namespace-import bicimi
    // uretir ve bu satir ESM altinda "X is not a constructor" ile duserdi.
    // Hata derlemede degil, yalnizca burada gorunur.
    expect(typeof catalogV1.CatalogServiceClient).toBe('function');
    expect(typeof inventoryV1.InventoryServiceClient).toBe('function');
    expect(typeof orderV1.OrderServiceClient).toBe('function');
  });

  it('servis tanimi tam nitelikli gRPC yolunu tasir', () => {
    // Yolun bicimi "/<proto paketi>.<Servis>/<Rpc>" olmak zorundadir; gateway ve
    // servisler ayni yolu kullanmazsa cagri UNIMPLEMENTED doner.
    expect(catalogV1.CatalogServiceService.listCategories.path).toBe(
      '/getir.catalog.v1.CatalogService/ListCategories',
    );
  });
});

describe('uretilen TypeScript - alan adlandirmasi (snakeToCamel)', () => {
  it('proto snake_case alanlari camelCase olarak uretilir', () => {
    // .proto icinde "amount_minor" yazar. camelCase karsiligi protobuf'in resmi
    // JSON eslemesidir; gateway'in urettigi REST JSON ile Node tarafi boylece
    // birebir ortusur ve arada isim cevirisi gerekmez.
    const money: commonV1.Money = { amountMinor: 4599, currency: 'TRY' };

    expect(money).toHaveProperty('amountMinor');
    expect(money).not.toHaveProperty('amount_minor');
  });
});

describe('uretilen TypeScript - kodlama/cozme', () => {
  it('para kurus cinsinden tam sayi olarak gidip gelir', () => {
    // int64 -> number esleniyor. Kurus tutarlari 2^53 sinirinin cok altinda
    // oldugu icin bu guvenli; float kullanilmadigi burada kanitlaniyor.
    const original: commonV1.Money = { amountMinor: 4599, currency: 'TRY' };

    const decoded = commonV1.Money.decode(commonV1.Money.encode(original).finish());

    expect(decoded).toEqual(original);
    expect(Number.isInteger(decoded.amountMinor)).toBe(true);
  });

  it('ic ice mesaj tasiyan bir istek turu bozulmadan gidip gelir', () => {
    // Sayfalama IMLEC tabanlidir (pageSize + pageToken), sayfa numarasi degil.
    const request: catalogV1.ListProductsRequest = {
      darkStoreId: 'store-1',
      categoryId: 'cat-1',
      query: '',
      page: { pageSize: 20, pageToken: '' },
    };

    const decoded = catalogV1.ListProductsRequest.decode(
      catalogV1.ListProductsRequest.encode(request).finish(),
    );

    expect(decoded.page).toEqual({ pageSize: 20, pageToken: '' });
    expect(decoded.darkStoreId).toBe('store-1');
  });

  it('set edilmeyen ic ice mesaj undefined kalir, bos nesne olmaz', () => {
    // useOptionals=messages secildigi icin yalnizca IC ICE MESAJ alanlari "?"
    // alir. Ayrim onemli: "page yok" ile "page var ama bos" istemcide farkli
    // davranis gerektirir (varsayilan sayfa boyutu uygulanir / uygulanmaz).
    const decoded = catalogV1.ListProductsRequest.decode(
      catalogV1.ListProductsRequest.encode({
        darkStoreId: 'store-1',
        categoryId: '',
        query: '',
      }).finish(),
    );

    expect(decoded.page).toBeUndefined();
  });

  it('enum sifir degeri UNSPECIFIED olarak uretilir', () => {
    // proto3'te 0 tel uzerinde hic gonderilmez; "set edilmedi" ile "gercekten ilk
    // deger" ayrimi ancak ayrilmis bir sifir degeriyle yapilabilir (buf.yaml
    // ENUM_ZERO_VALUE_SUFFIX kurali).
    expect(commonV1.Unit.UNIT_UNSPECIFIED).toBe(0);
  });
});
