import type { UseFormReturn } from 'react-hook-form';

import { CARD_FORM_FIELDS, isRequestField } from './card-form';
import type { CardFormField, CardFormValues } from './card-form';

/** Formun izlenen kismi (react-hook-form; testte createFormControl). */
export type WatchedCardForm = Pick<
  UseFormReturn<CardFormValues>,
  'watch' | 'getFieldState' | 'getValues' | 'trigger'
>;

/**
 * Kurali baska bir alanin degerine bagli alanlar: alan degisince bagli alan
 * yeniden denetlenir. Son kullanma ay ve yila birlikte bakar ("gecmis"
 * hatasi ay alaninda, "cok ileri" yil alaninda); CVV'nin uzunlugu numaranin
 * markasina bagli.
 */
const DEPENDENTS: readonly (readonly [CardFormField, readonly CardFormField[]])[] = [
  ['expiryMonth', ['expiryYear']],
  ['expiryYear', ['expiryMonth']],
  ['number', ['cvv']],
];

const asField = (name: string): CardFormField | undefined =>
  CARD_FORM_FIELDS.find((field) => field === name);

/**
 * Kart formundaki degisikliklere tepki (T11.17):
 *   - istegin bir alaninin DEGERI degisince deneme anahtarina haber verilir
 *     (QA C3, D2, K6): ayni degerle gelen degisiklik ve kosul onayi sayilmaz;
 *   - bagli alan yeniden denetlenir (QA O3, K2), ama yalnizca kullanici ona
 *     dokunduysa ya da hatasi gorunuyorsa: 01/2027 -> 2026'da ayin "gecmis"
 *     hatasi cikar, ay secilince dokunulmamis yil kirmizi olmaz; marka
 *     degisince CVV'nin eski hatasi kalmaz.
 * Donen fonksiyon aboneligi birakir.
 */
export function watchCardForm(form: WatchedCardForm, changed: () => void): () => void {
  const last = new Map<CardFormField, unknown>();
  const initial = form.getValues();
  for (const field of CARD_FORM_FIELDS) {
    last.set(field, initial[field]);
  }
  const subscription = form.watch((values, { name }) => {
    const field = name === undefined ? undefined : asField(name);
    if (field === undefined || values[field] === last.get(field)) {
      return;
    }
    last.set(field, values[field]);
    if (isRequestField(field)) {
      changed();
    }
    const dependents = DEPENDENTS.find(([source]) => source === field)?.[1] ?? [];
    const due = dependents.filter((dependent) => {
      const state = form.getFieldState(dependent);
      return state.isTouched || state.invalid;
    });
    if (due.length > 0) {
      void form.trigger([...due]);
    }
  });
  return () => subscription.unsubscribe();
}
