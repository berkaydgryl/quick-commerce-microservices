/**
 * Sorgu onbelleginden tek seferlik okuma (F16): okunan sorgu baska bir
 * bilesenin gozlemiyle suruyorken o bilesen kapanirsa TanStack istegi iptal
 * eder (CancelledError). Okumayi isteyen hala bekliyor: bir kez daha okunur,
 * ikinci okumanin gozlemcisi yoktur, iptal edilmez. Diger hatalar aynen doner.
 */

import { isCancelledError } from '@tanstack/react-query';

export async function readPastCancel<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isCancelledError(error)) {
      return read();
    }
    throw error;
  }
}
