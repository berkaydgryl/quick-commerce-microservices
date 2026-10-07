/**
 * Demo verisi: iki semtte 33 market, her birinin kendi kurallariyla (ADR-15).
 * Degerler docs/roadmap.md "Pazaryeri demo verisi" market tablosuyla birebir.
 * Konumlar apps/gateway/internal/persona/addresses.json'daki Ev (Kadikoy) ve Is (Besiktas)
 * adreslerinin yaricapi icindedir; Yazlik (Sile) hicbirinin icinde degil.
 *
 * T11.11: her semtte her dukkan turu var (market listesinin sol menusu bos
 * kalmasin). Yeni marketler adrese ilk altisindan UZAKTIR: yakin market
 * sirasinin basi degismez. Kapak dukkan turunun gorselidir (web
 * public/img/market, CC0, apps/web/README.md). Logo (07.10 kullanici karari,
 * GECICI): marka basina yazi logo, web public/img/market-logo/<marka>.svg
 * (yalniz ad + renk); istemci logo yuklenemezse bas harf rozeti gosterir.
 *
 * Cesitlilik (07.10): var olan markalarin 12 yeni subesi (semt basina 6),
 * eski marketlerin hepsinden uzak. Her semtte TAM BIR market kapalidir.
 *
 * Dosya boyutu kurali geregi parcalara bolunmustur; sira eklenme sirasidir
 * (eski 21 market ayni sirada basta, subeler sonda).
 */

import type { Market } from '../../domain/catalog.js';
import { BESIKTAS_MARKETS } from './markets/besiktas.js';
import { BESIKTAS_BRANCHES } from './markets/besiktas-branches.js';
import { KADIKOY_MARKETS } from './markets/kadikoy.js';
import { KADIKOY_BRANCHES } from './markets/kadikoy-branches.js';
import { PILOT_MARKETS } from './markets/pilot.js';

export const MARKETS: readonly Market[] = [
  ...PILOT_MARKETS,
  ...KADIKOY_MARKETS,
  ...BESIKTAS_MARKETS,
  ...KADIKOY_BRANCHES,
  ...BESIKTAS_BRANCHES,
];
