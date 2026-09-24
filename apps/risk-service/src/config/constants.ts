/** Risk servisinin is sabitleri (ADR-11). */

export const SERVICE_NAME = 'risk';

/**
 * Tek bir kuralin en fazla bekleyebilecegi sure. Evaluate checkout'un kritik
 * yolundadir; takilan bir kural siparisi bekletmemeli. Suresi dolan kural
 * hata gibi islenir: 0 puan + uyari, degerlendirme devam eder.
 */
export const RULE_TIMEOUT_MS = 200;
