import { describe, expect, it } from 'vitest';

import {
  cardvaultV1,
  catalogV1,
  commonV1,
  courierV1,
  inventoryV1,
  orderV1,
} from '../../gen/ts/index.js';

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
      darkStoreId: '',
      marketId: 'mkt_migros-jet-moda',
      categoryId: 'cat_1',
      query: '',
      page: { pageSize: 20, pageToken: '' },
    };

    const decoded = catalogV1.ListProductsRequest.decode(
      catalogV1.ListProductsRequest.encode(request).finish(),
    );

    expect(decoded.page).toEqual({ pageSize: 20, pageToken: '' });
    expect(decoded.marketId).toBe('mkt_migros-jet-moda');
  });

  it('set edilmeyen ic ice mesaj undefined kalir, bos nesne olmaz', () => {
    // useOptionals=messages secildigi icin yalnizca IC ICE MESAJ alanlari "?"
    // alir. Ayrim onemli: "page yok" ile "page var ama bos" istemcide farkli
    // davranis gerektirir (varsayilan sayfa boyutu uygulanir / uygulanmaz).
    const decoded = catalogV1.ListProductsRequest.decode(
      catalogV1.ListProductsRequest.encode({
        darkStoreId: '',
        marketId: 'mkt_migros-jet-moda',
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

describe('pazaryeri sozlesmesi (ADR-15)', () => {
  it('Market ve fiyat kurallari telden bozulmadan gidip gelir; puan tam sayidir', () => {
    const market: catalogV1.Market = {
      id: 'mkt_migros-jet-moda',
      name: 'Migros Jet - Moda',
      brand: 'Migros Jet',
      logoUrl: '/img/market/migros-jet.png',
      storeType: catalogV1.StoreType.STORE_TYPE_MARKET,
      coverUrl: '/img/market/market.jpg',
      location: { lat: 40.9867, lng: 29.0258 },
      deliveryRadiusMeters: 2500,
      isOpen: true,
      deliveryTime: { minMinutes: 15, maxMinutes: 25 },
      rating: { averageTenths: 47, count: 1200 },
      pricingRules: {
        minBasket: { amountMinor: 4000, currency: 'TRY' },
        deliveryFee: { amountMinor: 2490, currency: 'TRY' },
        freeDeliveryThreshold: { amountMinor: 30000, currency: 'TRY' },
      },
    };

    const decoded = catalogV1.Market.decode(catalogV1.Market.encode(market).finish());

    expect(decoded).toEqual(market);
    expect(Number.isInteger(decoded.rating?.averageTenths)).toBe(true);
  });

  it('fiyat urunde degil teklifte: Offer.price markete ozeldir', () => {
    const offer: catalogV1.Offer = {
      id: 'ofr_a101-caferaga-sut-1l',
      marketId: 'mkt_a101-caferaga',
      productId: 'prd_sut-1l',
      sku: 'SUT-1L',
      name: 'Sut 1 L',
      description: '',
      categoryId: 'cat_sut-kahvaltilik',
      unit: 0,
      imageUrl: '',
      price: { amountMinor: 3190, currency: 'TRY' },
      isActive: true,
    };

    const decoded = catalogV1.Offer.decode(catalogV1.Offer.encode(offer).finish());

    expect(decoded.price?.amountMinor).toBe(3190);
    expect(decoded.marketId).toBe('mkt_a101-caferaga');
  });
});

describe('kart kasasi sozlesmesi (T11.17)', () => {
  it('kart numarasi ve CVV yalnizca AddCardRequest te; maskeli kartta ve diger mesajlarda alan yok', () => {
    expect(Object.keys(cardvaultV1.AddCardRequest.fromPartial({}))).toEqual(
      expect.arrayContaining(['number', 'cvv']),
    );
    for (const message of [
      cardvaultV1.SavedCard.fromPartial({}),
      cardvaultV1.AddCardResponse.fromPartial({ card: {} }).card,
      cardvaultV1.ListCardsRequest.fromPartial({}),
      cardvaultV1.DeleteCardRequest.fromPartial({}),
    ]) {
      expect(Object.keys(message ?? {})).not.toContain('number');
      expect(Object.keys(message ?? {})).not.toContain('cvv');
    }
  });

  it('servis tanimi tam nitelikli gRPC yolunu tasir; maskeli kart telden bozulmadan gelir', () => {
    expect(cardvaultV1.CardVaultServiceService.addCard.path).toBe(
      '/getir.cardvault.v1.CardVaultService/AddCard',
    );
    const card = cardvaultV1.SavedCard.fromPartial({
      id: 'crd_0123456789abcdef0123456789abcdef',
      brand: cardvaultV1.CardBrand.CARD_BRAND_TROY,
      first4: '9792',
      last4: '0003',
      expiryMonth: 12,
      expiryYear: 2031,
      holderName: 'Ayşe Yılmaz',
      expired: false,
    });

    const decoded = cardvaultV1.SavedCard.decode(cardvaultV1.SavedCard.encode(card).finish());

    expect(decoded).toEqual(card);
  });
});

describe('uretilen TypeScript - cok dosyali paket (#135, D18)', () => {
  it('orderV1 hem order.proto hem checkout.proto mesajlarini tek ad alaninda verir', () => {
    // checkout.proto'ya tasinanlar: CheckoutSignals, OrderDetails, GiftDetails,
    // OrderPayment, DeliveryPaymentKind. Tuketici yolu (orderV1.X) degismez.
    for (const name of [
      'Order',
      'CreateOrderRequest',
      'OrderServiceClient',
      'CheckoutSignals',
      'OrderDetails',
      'GiftDetails',
      'OrderPayment',
      'DeliveryPaymentKind',
    ]) {
      expect(Object.keys(orderV1)).toContain(name);
    }
    expect(orderV1.protobufPackage).toBe('getir.order.v1');
  });

  it('dosyalar arasi tipler tasiyan istek bozulmadan gidip gelir', () => {
    const request = orderV1.CreateOrderRequest.fromPartial({
      orderId: 'ord_1',
      onDelivery: orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_POS,
      details: {
        note: 'Zili calma',
        doNotRingBell: true,
        agreementsAccepted: true,
        gift: {
          recipientName: 'Ali',
          recipientPhone: '+905321234567',
          message: '',
          senderName: '',
        },
      },
      signals: { ipAddress: '85.105.1.20', sessionLocation: { lat: 41, lng: 29 } },
    });

    const decoded = orderV1.CreateOrderRequest.decode(
      orderV1.CreateOrderRequest.encode(request).finish(),
    );

    expect(decoded).toEqual(request);
  });
});

describe('kurye takibi sozlesmesi (T13.3)', () => {
  it('GetTracking yolu ve asamalar; cevap telden bozulmadan gelir', () => {
    expect(courierV1.CourierServiceService.getTracking.path).toBe(
      '/getir.courier.v1.CourierService/GetTracking',
    );
    expect(courierV1.TrackingPhase.TRACKING_PHASE_TO_MARKET).toBe(1);
    expect(courierV1.TrackingPhase.TRACKING_PHASE_TO_CUSTOMER).toBe(2);
    expect(courierV1.TrackingPhase.TRACKING_PHASE_DELIVERED).toBe(3);
    const tracking = courierV1.GetTrackingResponse.fromPartial({
      courierId: 'crr_0123456789abcdef0123456789abcdef',
      courierName: 'Mehmet K.',
      phase: courierV1.TrackingPhase.TRACKING_PHASE_TO_CUSTOMER,
      location: { lat: 40.985, lng: 29.0275 },
      at: new Date('2026-10-07T13:00:02.000Z'),
      remainingMeters: 840,
      etaSeconds: 68,
      route: [
        { lat: 40.985, lng: 29.0275 },
        { lat: 40.9885, lng: 29.0262 },
      ],
      marketLocation: { lat: 40.985, lng: 29.0275 },
      deliveryLocation: { lat: 40.9885, lng: 29.0262 },
      pickedUpAt: new Date('2026-10-07T12:59:30.000Z'),
    });

    const decoded = courierV1.GetTrackingResponse.decode(
      courierV1.GetTrackingResponse.encode(tracking).finish(),
    );

    expect(decoded).toEqual(tracking);
    expect(decoded.deliveredAt).toBeUndefined();
  });
});
