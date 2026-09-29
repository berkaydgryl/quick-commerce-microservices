/**
 * Demo personalari (T8.5): gateway'in persona dosyasindaki SECILEBILIR
 * hesaplarin kopyasi (apps/gateway/internal/persona/personas.json; roadmap
 * "Test personalari"). Iki dosyanin ayni kaldigini test/unit/demo-personas.spec.ts
 * denetler.
 *
 * YALNIZCA gelistirme paketine girer (vite.config.ts __DEMO_PERSONAS__);
 * production paketinde olmadigini CI denetler (scripts/check-web-bundle.mjs).
 * Demo sifresi herkese aciktir (gateway README) ve baska yerde kullanilmaz;
 * yine de production'a bilinen sifreli hesap bilgisi tasinmaz.
 */

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DemoPersona {
  readonly persona: string;
  readonly band: RiskBand;
  /** E.164: "+905550000001". */
  readonly phone: string;
  readonly fullName: string;
}

export const DEMO_PASSWORD = 'Demo-Persona-2026';

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  { persona: 'Ayşe', band: 'LOW', phone: '+905550000001', fullName: 'Ayşe Yılmaz' },
  { persona: 'Zeynep', band: 'MEDIUM', phone: '+905550000002', fullName: 'Zeynep Kaya' },
  { persona: 'Can', band: 'HIGH', phone: '+905550000003', fullName: 'Can Demir' },
  { persona: 'Ali', band: 'CRITICAL', phone: '+905550000004', fullName: 'Ali Çelik' },
  { persona: 'Komşu', band: 'LOW', phone: '+905550000005', fullName: 'Mert Aydın' },
];

/** Secicide gorunen risk bandi adi. */
export const RISK_BAND_LABELS: Readonly<Record<RiskBand, string>> = {
  LOW: 'düşük risk',
  MEDIUM: 'orta risk',
  HIGH: 'yüksek risk',
  CRITICAL: 'kritik risk',
};
