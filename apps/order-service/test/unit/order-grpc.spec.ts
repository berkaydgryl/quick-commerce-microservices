/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci.
 * T3.2'nin "bitti sayilir" olcutunun (grpcurl ile orderId doner) otomatik karsiligi.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { ERROR_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildOrderService } from '../../src/bootstrap.js';

const EPHEMERAL_PORT = 0;
const IDEMPOTENCY_KEY = '4f1c3a2b-9d8e-11ee';

let handle: GrpcServerHandle;
let client: Client;

interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      new Metadata(),
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

function errorCodeOf(error: ServiceError | undefined): string | undefined {
  const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
  return typeof raw === 'string' ? (JSON.parse(raw) as { code: string }).code : undefined;
}

const draftRequest: orderV1.CreateDraftOrderRequest = {
  userId: 'usr_1',
  // Kullanimdan kalkan alan (ADR-15): sunucu okumaz, yeni istemci doldurmaz.
  darkStoreId: '',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy, İstanbul',
  idempotencyKey: IDEMPOTENCY_KEY,
};

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'order-test',
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [buildOrderService()],
  });
  client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

describe('CreateDraftOrder', () => {
  it('onekli orderId ve DRAFT durumu doner', async () => {
    const { error, response } = await call(
      orderV1.OrderServiceService.createDraftOrder,
      draftRequest,
    );

    expect(error).toBeUndefined();
    expect(response?.orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
    // Stok henuz kilitlenmiyor: rezervasyon bitis ani BOS olmali.
    expect(response?.reservationExpiresAt).toBeUndefined();
  });

  it('bos sepeti INVALID_ARGUMENT ile reddeder', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      lines: [],
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('market_id zorunlu ve mkt_ bicimli: eski ds_ kimligi reddedilir (ADR-15)', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      darkStoreId: 'ds_kadikoy',
      marketId: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('idempotency anahtari olmadan reddeder (ADR-08)', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      idempotencyKey: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('CreateOrder', () => {
  it('taslagi odeme bekler duruma gecirir', async () => {
    const draft = await call(orderV1.OrderServiceService.createDraftOrder, draftRequest);
    const orderId = draft.response?.orderId ?? '';

    const { error, response } = await call(orderV1.OrderServiceService.createOrder, {
      orderId,
      userId: 'usr_1',
      paymentMethod: 0,
      cardToken: '',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(error).toBeUndefined();
    expect(response?.orderId).toBe(orderId);
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    // 3DS akisi henuz yok: challengeId bos = "dogrulama beklenmiyor".
    expect(response?.challengeId).toBe('');
  });

  it('baskasinin siparisini NOT_FOUND ile reddeder', async () => {
    const draft = await call(orderV1.OrderServiceService.createDraftOrder, draftRequest);

    const { error } = await call(orderV1.OrderServiceService.createOrder, {
      orderId: draft.response?.orderId ?? '',
      userId: 'usr_2',
      paymentMethod: 0,
      cardToken: '',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('ayni siparis ikinci kez olusturulursa FAILED_PRECONDITION doner', async () => {
    const draft = await call(orderV1.OrderServiceService.createDraftOrder, draftRequest);
    const request = {
      orderId: draft.response?.orderId ?? '',
      userId: 'usr_1',
      paymentMethod: 0,
      cardToken: '',
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    await call(orderV1.OrderServiceService.createOrder, request);
    const { error } = await call(orderV1.OrderServiceService.createOrder, request);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });
});

describe('CancelOrder', () => {
  async function newDraftId(): Promise<string> {
    return (
      (await call(orderV1.OrderServiceService.createDraftOrder, draftRequest)).response?.orderId ??
      ''
    );
  }

  it('taslagi iptal eder, CANCELLED doner', async () => {
    const orderId = await newDraftId();

    const { error, response } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: 'CHANGED_MIND',
    });

    expect(error).toBeUndefined();
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_CANCELLED);
  });

  it('iptal edilmis siparisi ikinci kez iptal: FAILED_PRECONDITION', async () => {
    const orderId = await newDraftId();
    await call(orderV1.OrderServiceService.cancelOrder, { orderId, userId: 'usr_1', reason: '' });

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });

  it('gerekce anahtar bicimi disindaysa INVALID_ARGUMENT', async () => {
    const orderId = await newDraftId();

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: 'fikrimi degistirdim',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  it('baskasinin siparisi NOT_FOUND', async () => {
    const orderId = await newDraftId();

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_2',
      reason: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});

describe('GetOrder', () => {
  it('siparisi market, durum ve zaman cizelgesiyle doner', async () => {
    const orderId =
      (await call(orderV1.OrderServiceService.createDraftOrder, draftRequest)).response?.orderId ??
      '';

    const { error, response } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_1',
    });

    expect(error).toBeUndefined();
    expect(response?.order).toMatchObject({
      id: orderId,
      userId: 'usr_1',
      marketId: 'mkt_migros-jet-moda',
      status: orderV1.OrderStatus.ORDER_STATUS_DRAFT,
      deliveryAddress: 'Kadıköy, İstanbul',
    });
    expect(response?.order?.timeline.map((entry) => entry.status)).toEqual([
      orderV1.OrderStatus.ORDER_STATUS_DRAFT,
    ]);
    expect(response?.order?.createdAt).toBeInstanceOf(Date);
    // Fiyatlar henuz hesaplanmiyor (T9.3): uydurma "0 TL" yerine alan yok.
    expect(response?.order?.total).toBeUndefined();
  });

  it('baskasinin siparisi NOT_FOUND (PERMISSION_DENIED degil)', async () => {
    const orderId =
      (await call(orderV1.OrderServiceService.createDraftOrder, draftRequest)).response?.orderId ??
      '';

    const { error } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_2',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});

describe('ListMyOrders', () => {
  // Sunucu testler boyunca ayni bellek deposunu kullanir: bu blok kendi kullanicisini acar.
  const userId = 'usr_history';

  beforeAll(async () => {
    for (let index = 0; index < 3; index += 1) {
      await call(orderV1.OrderServiceService.createDraftOrder, { ...draftRequest, userId });
    }
  });

  it('jetonla sayfalar: kayit kaybolmaz, tekrar etmez, son sayfada jeton bos', async () => {
    const first = await call(orderV1.OrderServiceService.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: '' },
    });
    const second = await call(orderV1.OrderServiceService.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: first.response?.page?.nextPageToken ?? '' },
    });

    expect(first.response?.orders).toHaveLength(2);
    expect(first.response?.page?.nextPageToken).not.toBe('');
    expect(second.response?.orders).toHaveLength(1);
    expect(second.response?.page?.nextPageToken).toBe('');

    const ids = [...(first.response?.orders ?? []), ...(second.response?.orders ?? [])].map(
      (order) => order.id,
    );
    expect(new Set(ids).size).toBe(3);
    expect(
      [...(first.response?.orders ?? []), ...(second.response?.orders ?? [])].every(
        (order) => order.userId === userId,
      ),
    ).toBe(true);
  });

  it('page gonderilmezse varsayilan boyutla ilk sayfa', async () => {
    const { error, response } = await call(orderV1.OrderServiceService.listMyOrders, { userId });

    expect(error).toBeUndefined();
    expect(response?.orders).toHaveLength(3);
  });

  it('siparisi olmayan kullanici: bos liste, hata degil', async () => {
    const { error, response } = await call(orderV1.OrderServiceService.listMyOrders, {
      userId: 'usr_yeni',
    });

    expect(error).toBeUndefined();
    expect(response?.orders).toEqual([]);
    expect(response?.page?.nextPageToken).toBe('');
  });

  it('bu sunucunun uretmedigi jeton INVALID_ARGUMENT', async () => {
    const { error } = await call(orderV1.OrderServiceService.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: 'uydurma-jeton' },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
