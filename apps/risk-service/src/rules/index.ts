/**
 * Cekirdek kurallar (roadmap "Taahhude dahil cekirdek kurallar", T6.2).
 *
 * Yeni kural: bu listeye bir satir + config/risk.rules.json'a bir satir. Kayit
 * iki yonlu eslesmeyi acilista dogrular. Saate ihtiyac duyan kural (hesap yasi)
 * saati disaridan alir; testte sabitlenir.
 */

import type { Clock } from '@getir/core';

import type { Rule } from '../domain/rule.js';
import { createAccountAgeRule } from './account-age.rule.js';
import { basketAnomalyRule } from './basket-anomaly.rule.js';
import { checkoutDwellRule } from './checkout-dwell.rule.js';
import { geofenceRule } from './geofence.rule.js';
import { ipDeviceRule } from './ip-device.rule.js';
import { orderHistoryRule } from './order-history.rule.js';

export function createCoreRules(clock: Clock): readonly Rule[] {
  return [
    createAccountAgeRule(clock),
    orderHistoryRule,
    basketAnomalyRule,
    checkoutDwellRule,
    geofenceRule,
    ipDeviceRule,
  ];
}
