/**
 * ip-device: iki sinyal, TEK kural (puanini bir kez verir):
 *  - ayni cihazda 3+ hesap -> KESIN KURAL (veto): skor ne olursa olsun CRITICAL
 *    (config'te severity "block");
 *  - IP degisimi (onceki oturumdan farkli) -> yalnizca puan.
 * Gerekce IP adresini ya da cihaz kimligini YAZMAZ (kisisel veri).
 */

import { MAX_ACCOUNTS_PER_DEVICE } from '../config/constants.js';
import type { Rule } from '../domain/rule.js';

export const ipDeviceRule: Rule = {
  id: 'ip-device',
  evaluate: ({ accountsOnDevice, ipAddress, previousIpAddress }) => {
    const sharedDevice =
      accountsOnDevice !== undefined && accountsOnDevice >= MAX_ACCOUNTS_PER_DEVICE;
    const ipChanged =
      ipAddress !== undefined && previousIpAddress !== undefined && ipAddress !== previousIpAddress;

    const reasons = [
      ...(sharedDevice ? [`cihazda ${accountsOnDevice} hesap`] : []),
      ...(ipChanged ? ['IP onceki oturumdan farkli'] : []),
    ];
    return Promise.resolve(
      reasons.length === 0
        ? { hit: false, reason: 'cihaz ve IP olagan' }
        : { hit: true, reason: reasons.join(', '), veto: sharedDevice },
    );
  },
};
