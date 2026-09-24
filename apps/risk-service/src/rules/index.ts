/**
 * Cekirdek kurallar (roadmap "Taahhude dahil cekirdek kurallar").
 *
 * T6.1 motoru kurar; alti kural (account-age, order-history, basket-anomaly,
 * checkout-dwell, geofence, ip-device) T6.2'de bu listeye eklenir. Kayit,
 * config/risk.rules.json ile iki yonlu eslesmeyi acilista dogrular.
 */

import type { Rule } from '../domain/rule.js';

export const CORE_RULES: readonly Rule[] = [];
