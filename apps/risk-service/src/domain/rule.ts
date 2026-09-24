/**
 * Kural arayuzu: KURAL = DOSYA ilkesi. Yeni kural bir dosya yazmak ve
 * config/risk.rules.json'a bir satir eklemektir; motor degismez.
 *
 * Kural yalnizca "tetiklendim mi, neden, veto istiyor muyum" sorusunu
 * cevaplar. AGIRLIK ve VETO YETKISI config'tedir: kural kendine puan ya da
 * engelleme yetkisi veremez, operasyon kodu degistirmeden ayarlar.
 */

import type { RiskContext } from './risk-context.js';

export interface RuleOutcome {
  readonly hit: boolean;
  /** Gelistiriciye yonelik kisa gerekce ("hesap 4 saatlik"). Kisisel veri tasimaz. */
  readonly reason: string;
  /**
   * Kesin kural istegi (ornegin ayni cihazda 3+ hesap). Yalnizca config'te
   * severity "block" olan kuralda dikkate alinir; digerlerinde yok sayilir.
   */
  readonly veto?: boolean;
}

export interface Rule {
  /** Config anahtari ve risk_events'teki kimlik (kebab-case, ornegin "ip-device"). */
  readonly id: string;
  evaluate(context: RiskContext): Promise<RuleOutcome>;
}

/** Config'teki ciddiyet: "score" yalnizca puan verir, "block" veto edebilir. */
export type RuleSeverity = 'score' | 'block';

/** Kosturulmus kuralin sonucu (proto RuleHit). Tetiklenmeyen kural da listede durur. */
export interface RuleResult {
  readonly ruleId: string;
  readonly hit: boolean;
  readonly weight: number;
  /** Skora katkisi: tetiklendiyse agirlik, degilse 0. */
  readonly score: number;
  readonly reason: string;
  readonly veto: boolean;
}
