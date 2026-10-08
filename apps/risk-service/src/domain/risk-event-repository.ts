/**
 * risk_events deposu portu. MOCK'ta bellek, aksi halde Mongo; ikisi ayni
 * sozlesme testinden gecer.
 */

import type { RiskEvent } from './risk-event.js';

export interface LatestEventQuery {
  readonly userId: string;
  /** Verilirse o siparisin son degerlendirmesi, verilmezse kullanicinin son degerlendirmesi. */
  readonly orderId?: string;
}

/** Kullanicinin bir andan bu yana degerlendirmeleri (#164, yapiskan bant). */
export interface RecentEventsQuery {
  readonly userId: string;
  /** Bu an DAHIL ve sonrasi. */
  readonly since: Date;
  /**
   * Verilirse surucuye ISLEM BASINA sinir (ms): sure dolunca surucu islemi
   * birakir, baglanti havuza doner (cagiranin beklemeyi birakmasi yetmez).
   */
  readonly timeoutMs?: number;
}

export interface RiskEventRepository {
  insert(event: RiskEvent): Promise<void>;
  /** En yeni kayit (evaluatedAt azalan); yoksa null. */
  findLatest(query: LatestEventQuery): Promise<RiskEvent | null>;
}

/**
 * Yakin degerlendirmeleri okuma portu (#164, yapiskan bant). Ayri port: kayit ve
 * son kayit okumasi bu ihtiyaci tasimaz; iki depo da ikisini uygular.
 */
export interface RecentRiskEvents {
  /**
   * `since`'ten bu yana bandi en yuksek TEK kayit (Mongo sirasi: vetolu kayit once,
   * vetolular kural kimligine gore azalan; sonra skor; sonra en yeni; sonra kimlik
   * azalan); yoksa null. Bant skordan ya da vetodan gelir. "En yeni N kayit" DEGIL: dusuk skorlu
   * kayitlarla (or. reddedilen kapida odeme denemeleri) yuksek kayit tahliye
   * edilemez (#164 guvenlik incelemesi).
   */
  findHighestRecent(query: RecentEventsQuery): Promise<RiskEvent | null>;
}
