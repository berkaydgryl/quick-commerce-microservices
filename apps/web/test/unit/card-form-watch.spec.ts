/**
 * Kart formunun izlenmesi (T11.17): istegin alanlari deneme anahtarina haber
 * verir, kosul onayi vermez (QA D2); son kullanma hatasi iki secimde birlikte
 * yeniden denetlenir (QA O3). Gercek react-hook-form denetimiyle
 * (createFormControl), DOM'suz. Bagli alan yalnizca dokunulmus ya da
 * hatasi gorunurken yeniden denetlenir (QA K2); ayni degerle gelen
 * degisiklik anahtari yenilemez (QA K6).
 */

import { CARD_FIELD_MESSAGES, CONTENT_FALLBACK } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFormControl } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_CARD_FORM, cardFormSchema } from '../../src/features/cards/services/card-form';
import type { CardFormValues } from '../../src/features/cards/services/card-form';
import { watchCardForm } from '../../src/features/cards/services/card-form-watch';

import { VISA_NUMBER } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.paymentMethods;
const NOW = new Date('2026-10-05T12:00:00.000Z');

function setup(values: Partial<CardFormValues> = {}) {
  const form = createFormControl<CardFormValues>({
    resolver: zodResolver(cardFormSchema(TEXTS, () => NOW)),
    defaultValues: { ...EMPTY_CARD_FORM, ...values },
    mode: 'onTouched',
  });
  // useForm bilesen baglaninca formu "bagli" sayar; createFormControl'da bunu
  // genel subscribe yapar (bagli olmayan formda watch alan adini vermez).
  form.subscribe({ formState: { errors: true }, callback: () => undefined });
  const changed = vi.fn();
  const stop = watchCardForm(form, changed);
  return { form, changed, stop };
}

/** Bekleyen denetimler (trigger) bitsin. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Form = ReturnType<typeof setup>['form'];

/** Kullanicinin alandan cikmasi (onTouched: alan dokunulmus sayilir ve denetlenir). */
async function touch(form: Form, name: keyof CardFormValues) {
  await form.register(name).onBlur({ target: { name, value: form.getValues(name) }, type: 'blur' });
}

/** Kullanicinin alana yazmasi/secmesi (Controller'in onChange'i). */
async function type(form: Form, name: keyof CardFormValues, value: string) {
  await form.register(name).onChange({ target: { name, value }, type: 'change' });
}

describe('watchCardForm (T11.17)', () => {
  it('QA D2: istegin alanlari anahtara haber verir; kosul onayi vermez', () => {
    const { form, changed } = setup();

    form.setValue('nickname', 'İş');
    form.setValue('expiryYear', '2029');
    expect(changed).toHaveBeenCalledTimes(2);

    form.setValue('terms', true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('QA O3: ay alanindaki "gecmis" hatasi yil degisince kalkar', async () => {
    const { form } = setup({
      number: VISA_NUMBER,
      holderName: 'Ayşe Yılmaz',
      expiryMonth: '01',
      expiryYear: '2026',
      cvv: '123',
      terms: true,
    });
    await form.trigger();
    expect(form.getFieldState('expiryMonth').error?.message).toBe(CARD_FIELD_MESSAGES.expired);

    form.setValue('expiryYear', '2027');
    await settle();

    expect(form.getFieldState('expiryMonth').invalid).toBe(false);
    expect(form.getFieldState('expiryYear').invalid).toBe(false);
  });

  it('hata yokken son kullanma degisikligi erken uyari gostermez', async () => {
    const { form } = setup();

    form.setValue('expiryMonth', '08');
    await settle();

    expect(form.getFieldState('expiryYear').invalid).toBe(false);
  });

  it('abonelik birakilir', () => {
    const { form, changed, stop } = setup();
    stop();

    form.setValue('nickname', 'İş');

    expect(changed).not.toHaveBeenCalled();
  });

  it('QA K2: 01/2027 -> 2026 yapilinca ayin "gecmis" hatasi cikar', async () => {
    const { form } = setup({ expiryMonth: '01', expiryYear: '2027' });
    await touch(form, 'expiryMonth');
    expect(form.getFieldState('expiryMonth').invalid).toBe(false);

    await type(form, 'expiryYear', '2026');
    await settle();

    expect(form.getFieldState('expiryMonth').error?.message).toBe(CARD_FIELD_MESSAGES.expired);
  });

  it('QA K2: ay "zorunlu" hatasindayken ay secilince dokunulmamis yil kirmizi olmaz', async () => {
    const { form } = setup();
    await touch(form, 'expiryMonth');
    expect(form.getFieldState('expiryMonth').error?.message).toBe(TEXTS.expiryRequiredNotice);

    await type(form, 'expiryMonth', '08');
    await settle();

    expect(form.getFieldState('expiryMonth').invalid).toBe(false);
    expect(form.getFieldState('expiryYear').invalid).toBe(false);
  });

  it('QA K2: marka degisince CVV yeniden denetlenir (Visa 4 hane hatali -> Amex gecerli)', async () => {
    const { form } = setup({ number: VISA_NUMBER, cvv: '1234' });
    await touch(form, 'cvv');
    expect(form.getFieldState('cvv').error?.message).toBe(CARD_FIELD_MESSAGES.cvv);

    await type(form, 'number', '378282246310005');
    await settle();

    expect(form.getFieldState('cvv').invalid).toBe(false);
  });

  it('QA K6: ayni degerle gelen degisiklik anahtari yenilemez', async () => {
    const { form, changed } = setup();

    await type(form, 'cvv', '');
    expect(changed).not.toHaveBeenCalled();

    await type(form, 'cvv', '1');
    await type(form, 'cvv', '1');
    expect(changed).toHaveBeenCalledOnce();
  });
});
