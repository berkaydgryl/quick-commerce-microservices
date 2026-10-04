/** Use-case: kuryeyi kimligiyle okur; yoksa NOT_FOUND. */

import { AppError } from '@getir/core';

import type { Courier } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';

export type GetCourier = (courierId: string) => Promise<Courier>;

export function createGetCourier(repository: CourierRepository): GetCourier {
  return async (courierId) => {
    const courier = await repository.findById(courierId);
    if (courier === null) {
      throw AppError.notFound('Kurye bulunamadi', { details: { courierId } });
    }
    return courier;
  };
}
