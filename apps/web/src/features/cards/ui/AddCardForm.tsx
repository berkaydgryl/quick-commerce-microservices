import {
  CARD_HOLDER_NAME_MAX_LENGTH,
  CARD_NICKNAME_MAX_LENGTH,
  cardNumberProblem,
  cvvLengthOf,
  normalizeCardText,
} from '@getir/contracts';
import { errorMessage } from '@getir/contracts';
import type { AddCardRequest, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { AuthField } from '../../auth/ui/AuthField';
import { useNow } from '../../profile/hooks/useNow';
import { formatCountdown, secondsUntil } from '../../profile/services/code-window';
import { faceHolderName, typedCardFace } from '../services/card-face';
import {
  CARD_FORM_FIELDS,
  EMPTY_CARD_FORM,
  cardFormFeedback,
  cardFormSchema,
  retryWaitSeconds,
  toAddCardRequest,
} from '../services/card-form';
import type { CardFormValues } from '../services/card-form';
import {
  cardNumberDigits,
  cvvDigits,
  formatCardNumber,
  formatExpiryInput,
  typingBrand,
} from '../services/card-input';

import styles from './AddCardForm.module.css';
import { BrandPills } from './BrandPills';
import { CardVisual } from './CardVisual';
import type { CardFocus } from './CardVisual';

interface AddCardFormProps {
  readonly texts: PaymentMethodsContent;
  /** Karti kaydeder (useAddCard); hata verirse firlatir. */
  readonly onSave: (request: AddCardRequest) => Promise<SavedCard>;
  /** Kayit bitti: sayfa listeye doner ve bildirim gosterir. */
  readonly onSaved: (card: SavedCard) => void;
}

/** Kartin hangi yuzu ve cercevesi: alan -> kart bolgesi. */
type FormFocus = CardFocus | 'cvv';

const MASK = '•';
const DEFAULT_CVV_LENGTH = 3;
const MS_PER_SECOND = 1000;

/**
 * Kart ekle (T11.17, tasarim B "Markanin rengi"; M5): baslikta desteklenen
 * markalar, gri sahnede canli kart, altinda form. Numara yazildikca kart o
 * markanin rengine gecer; odaktaki alan kartta cercevelenir; CVV alaninda
 * kart doner. Alanlar butun formlardaki ortak alan (yuzen etiket).
 *
 * Kurallar ve cumleler sozlesmeden (services/card-form.ts); karar sunucuda.
 * Numara ve CVV YALNIZCA bu formun durumunda yasar (M7): kart gorseline
 * maskeli gider, onbellege yazilmaz; form kapaninca gider.
 */
export function AddCardForm({ texts, onSave, onSaved }: AddCardFormProps) {
  const titleId = useId();
  const [focus, setFocus] = useState<FormFocus>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  /** Cok fazla deneme (429): tekrar denenebilecek an (ms); yoksa null. */
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const now = useNow(retryAt !== null);
  const waitSeconds = retryAt === null ? 0 : secondsUntil(retryAt, now);
  const schema = useMemo(() => cardFormSchema(texts.expiryFormatNotice), [texts]);
  const {
    control,
    handleSubmit,
    setError,
    setFocus: focusField,
    formState: { isSubmitting },
  } = useForm<CardFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_CARD_FORM,
    mode: 'onTouched',
  });
  const values = useWatch({ control }) as CardFormValues;
  const brand = typingBrand(values.number);
  const nickname = normalizeCardText(values.nickname);
  const cvvLength = brand === null ? DEFAULT_CVV_LENGTH : cvvLengthOf(brand);

  // Bekleme bitti: uyari kalkar, kaydet acilir.
  useEffect(() => {
    if (retryAt !== null && waitSeconds === 0) {
      setRetryAt(null);
      setFormMessage(null);
    }
  }, [retryAt, waitSeconds]);

  const submit = handleSubmit(
    async (form) => {
      setFormMessage(null);
      try {
        onSaved(await onSave(toAddCardRequest(form)));
      } catch (error) {
        const wait = retryWaitSeconds(error);
        if (wait !== null) {
          setRetryAt(Date.now() + wait * MS_PER_SECOND);
          setFormMessage(errorMessage(ERROR_CODES.RATE_LIMITED));
          return;
        }
        const feedback = cardFormFeedback(error);
        showServerErrors(CARD_FORM_FIELDS, feedback.fields, setError);
        setFormMessage(feedback.message);
      }
    },
    (errors) => focusFirstInvalid(CARD_FORM_FIELDS, errors, focusField),
  );

  const leave = (onBlur: () => void) => () => {
    onBlur();
    setFocus(null);
  };

  return (
    <section className={styles['c-add-card']} aria-labelledby={titleId}>
      <header className={styles['c-add-card__head']}>
        <h1 id={titleId} className={styles['c-add-card__title']}>
          {texts.addTitle}
        </h1>
        <BrandPills labels={texts.brandLabels} label={texts.brandsLabel} active={brand} />
      </header>
      <div className={styles['c-add-card__stage']}>
        <CardVisual
          size="large"
          brand={brand}
          groups={typedCardFace(values.number, brand)}
          holderName={faceHolderName(values.holderName, texts.holderPlaceholder)}
          expiry={values.expiry === '' ? texts.expiryPlaceholder : values.expiry}
          nickname={nickname === '' ? texts.nicknamePlaceholder : nickname}
          cvvMask={MASK.repeat(values.cvv === '' ? cvvLength : values.cvv.length)}
          texts={texts}
          flipped={focus === 'cvv'}
          focus={focus === 'cvv' ? null : focus}
        />
      </div>
      <form
        className={styles['c-add-card__form']}
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {formMessage !== null && (
          <div className={styles['c-add-card__alert']} role="alert">
            <p>{formMessage}</p>
            {waitSeconds > 0 && (
              <p className={styles['c-add-card__wait']}>
                {texts.retryWaitLabel} <time>{formatCountdown(waitSeconds)}</time>
              </p>
            )}
          </div>
        )}
        <Controller
          name="number"
          control={control}
          render={({ field, fieldState }) => (
            <div className={styles['c-add-card__number']}>
              <AuthField
                ref={field.ref}
                id="kart-numara"
                name={field.name}
                label={texts.numberLabel}
                floatingLabel
                inputMode="numeric"
                autoComplete="cc-number"
                value={formatCardNumber(field.value)}
                onChange={(event) => field.onChange(cardNumberDigits(event.target.value))}
                onFocus={() => setFocus('number')}
                onBlur={leave(field.onBlur)}
                error={fieldState.error?.message}
              />
              {fieldState.error === undefined && cardNumberProblem(field.value) === null && (
                <p className={styles['c-add-card__valid']}>{texts.numberValidLabel}</p>
              )}
            </div>
          )}
        />
        <Controller
          name="holderName"
          control={control}
          render={({ field, fieldState }) => (
            <AuthField
              ref={field.ref}
              id="kart-ad"
              name={field.name}
              label={texts.holderNameLabel}
              floatingLabel
              autoComplete="cc-name"
              maxLength={CARD_HOLDER_NAME_MAX_LENGTH}
              value={field.value}
              onChange={field.onChange}
              onFocus={() => setFocus('holderName')}
              onBlur={leave(field.onBlur)}
              error={fieldState.error?.message}
            />
          )}
        />
        <div className={styles['c-add-card__pair']}>
          <Controller
            name="expiry"
            control={control}
            render={({ field, fieldState }) => (
              <AuthField
                ref={field.ref}
                id="kart-skt"
                name={field.name}
                label={texts.expiryLabel}
                floatingLabel
                inputMode="numeric"
                autoComplete="cc-exp"
                value={field.value}
                onChange={(event) => field.onChange(formatExpiryInput(event.target.value))}
                onFocus={() => setFocus('expiry')}
                onBlur={leave(field.onBlur)}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            name="cvv"
            control={control}
            render={({ field, fieldState }) => (
              <AuthField
                ref={field.ref}
                id="kart-cvv"
                name={field.name}
                label={texts.cvvLabel}
                floatingLabel
                inputMode="numeric"
                autoComplete="cc-csc"
                value={field.value}
                onChange={(event) => field.onChange(cvvDigits(event.target.value, brand))}
                onFocus={() => setFocus('cvv')}
                onBlur={leave(field.onBlur)}
                error={fieldState.error?.message}
              />
            )}
          />
        </div>
        <Controller
          name="nickname"
          control={control}
          render={({ field, fieldState }) => (
            <AuthField
              ref={field.ref}
              id="kart-takma-ad"
              name={field.name}
              label={texts.nicknameLabel}
              floatingLabel
              autoComplete="off"
              maxLength={CARD_NICKNAME_MAX_LENGTH}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <button
          type="submit"
          className={styles['c-add-card__submit']}
          disabled={isSubmitting || waitSeconds > 0}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? texts.savingLabel : texts.saveLabel}
        </button>
        <p className={styles['c-add-card__note']}>{texts.privacyNote}</p>
      </form>
    </section>
  );
}
