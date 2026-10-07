import { errorMessage } from '@getir/contracts';
import type { AddCardRequest, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { useNow } from '../../profile/hooks/useNow';
import { secondsUntil } from '../../profile/services/code-window';
import {
  CARD_FORM_FIELDS,
  EMPTY_CARD_FORM,
  cardFormFeedback,
  cardFormSchema,
  retryWaitSeconds,
  toAddCardRequest,
} from '../services/card-form';
import type { CardFormValues } from '../services/card-form';
import { watchCardForm } from '../services/card-form-watch';
import { createSingleFlight } from '../services/single-flight';

const MS_PER_SECOND = 1000;

interface UseCardFormInput {
  readonly texts: PaymentMethodsContent;
  /** Karti kaydeder (useAddCard); hata verirse firlatir. */
  readonly save: (request: AddCardRequest) => Promise<SavedCard>;
  /** Formun bir alani degisti (QA C3: belirsiz denemeden korunan anahtar birakilir). */
  readonly changed: () => void;
  /** Kayit bitti: sayfa listeye doner ve bildirim gosterir. */
  readonly onSaved: (card: SavedCard) => void;
}

/**
 * Kart ekleme formunun mantigi (T11.17; AddCardForm'dan ayrildi, SRP): sema,
 * gonderme, sunucu hatasinin alanlara eslenmesi ve cok fazla denemede (429)
 * geri sayim. Odak sozlesmenin sirasiyla elle verilir (shouldFocusError
 * kapali: react-hook-form'un kendi odagi ikinci kez odaklamasin).
 */
export function useCardForm({ texts, save, changed, onSaved }: UseCardFormInput) {
  const schema = useMemo(() => cardFormSchema(texts), [texts]);
  const form = useForm<CardFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_CARD_FORM,
    mode: 'onTouched',
    shouldFocusError: false,
  });
  const watched = useWatch({ control: form.control });
  const values: CardFormValues = { ...EMPTY_CARD_FORM, ...watched };
  const [formMessage, setFormMessage] = useState<string | null>(null);
  /** Cok fazla deneme (429): tekrar denenebilecek an (ms); yoksa null. */
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const now = useNow(retryAt !== null);
  const waitSeconds = retryAt === null ? 0 : secondsUntil(retryAt, now);
  /** Kayit surerken ikinci gonderme birakilir: ikinci POST gitmez (F5 ek sart 3). */
  const [once] = useState(createSingleFlight);

  // Istegin alani degisince anahtar (QA C3, D2); son kullanma ikisi birlikte (QA O3).
  useEffect(() => watchCardForm(form, changed), [form, changed]);

  // Bekleme bitti: uyari kalkar, Devam acilir.
  useEffect(() => {
    if (retryAt !== null && waitSeconds === 0) {
      setRetryAt(null);
      setFormMessage(null);
    }
  }, [retryAt, waitSeconds]);

  const submit = form.handleSubmit(
    (submitted) =>
      once(async () => {
        setFormMessage(null);
        try {
          onSaved(await save(toAddCardRequest(submitted)));
        } catch (error) {
          const wait = retryWaitSeconds(error);
          if (wait !== null) {
            setRetryAt(Date.now() + wait * MS_PER_SECOND);
            setFormMessage(errorMessage(ERROR_CODES.RATE_LIMITED));
            return;
          }
          const feedback = cardFormFeedback(error, texts.duplicateCardNotice);
          showServerErrors(CARD_FORM_FIELDS, feedback.fields, form.setError);
          setFormMessage(feedback.message);
        }
      }),
    (errors) => focusFirstInvalid(CARD_FORM_FIELDS, errors, form.setFocus),
  );

  return { form, values, formMessage, waitSeconds, submit };
}
