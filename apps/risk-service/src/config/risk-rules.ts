/** Paketle gelen kural ayarlari, dogrulanmis. Tek okuma yeri. */

import rawRules from './risk.rules.json' with { type: 'json' };
import { parseRiskRulesConfig } from './rule-config.js';
import type { RiskRulesConfig } from './rule-config.js';

export const riskRulesConfig: RiskRulesConfig = parseRiskRulesConfig(rawRules);
