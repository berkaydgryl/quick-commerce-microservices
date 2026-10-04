/** GetCourier (NOT_FOUND) ve ReleaseCourier (tekrar guvenli) use-case'leri. */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createGetCourier } from '../../src/application/get-courier.js';
import { createReleaseCourier } from '../../src/application/release-courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { courier, courierId, NOW_MS, orderId } from '../support/couriers.js';

describe('createGetCourier', () => {
  it('kuryeyi doner; yoksa NOT_FOUND', async () => {
    const get = createGetCourier(new InMemoryCourierStore([courier(1)]));

    await expect(get(courierId(1))).resolves.toEqual(courier(1));
    await expect(get(courierId(2))).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { courierId: courierId(2) },
    });
  });
});

describe('createReleaseCourier', () => {
  it('siparisi tasiyan kuryeyi birakir; tekrar cagri hata degil released=false', async () => {
    const order = orderId();
    const repository = new InMemoryCourierStore([
      courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order }),
    ]);
    const release = createReleaseCourier(repository, fixedClock(NOW_MS));
    const lines: LogLine[] = [];

    const first = await release(order, recordingLogger(lines));
    const second = await release(order, recordingLogger(lines));

    expect(first).toEqual({ released: true, courierId: courierId(1) });
    expect(second).toEqual({ released: false });
    // Kurye oldugu yerde IDLE kalir; bosta beklemesi birakma aninda baslar (#88).
    expect(await repository.findById(courierId(1))).toEqual(
      courier(1, { idleSince: new Date(NOW_MS) }),
    );
    expect(lines.map((line) => [line.message, line.fields])).toEqual([
      ['kurye birakildi', { orderId: order, courierId: courierId(1) }],
      ['birakilacak kurye yok (zaten birakilmis ya da atanmamis)', { orderId: order }],
    ]);
  });
});
