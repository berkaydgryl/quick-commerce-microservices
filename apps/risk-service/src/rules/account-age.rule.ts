/** account-age: hesap 24 saatten yeni. Yeni hesaplar dolandiricilikta en sik sinyal. */

import type { Clock } from '@getir/core';

import { NEW_ACCOUNT_MAX_AGE_MS } from '../config/constants.js';
import type { Rule } from '../domain/rule.js';

const MS_PER_HOUR = 60 * 60 * 1000;

export function createAccountAgeRule(clock: Clock): Rule {
  return {
    id: 'account-age',
    evaluate: ({ accountCreatedAt }) => {
      if (accountCreatedAt === undefined) {
        return Promise.resolve({ hit: false, reason: 'hesap yasi bilinmiyor' });
      }
      const ageMs = clock.now() - accountCreatedAt.getTime();
      const hours = Math.floor(ageMs / MS_PER_HOUR);
      return Promise.resolve(
        ageMs < NEW_ACCOUNT_MAX_AGE_MS
          ? { hit: true, reason: `hesap ${hours} saatlik` }
          : { hit: false, reason: `hesap ${hours} saatlik` },
      );
    },
  };
}
