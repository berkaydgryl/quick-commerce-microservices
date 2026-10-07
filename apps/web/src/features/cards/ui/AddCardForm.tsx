import {
  CARD_HOLDER_NAME_MAX_LENGTH,
  CARD_NICKNAME_MAX_LENGTH,
  cardExpiryYears,
  cardNumberProblem,
  cvvLengthOf,
  normalizeCardText,
} from '@getir/contracts';
import type { AddCardRequest, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';

import { AuthField } from '../../auth/ui/AuthField';
import { useCardForm } from '../hooks/useCardForm';
import { faceExpiry, faceHolderName, typedCardFace } from '../services/card-face';
import { cvvDigits, typingBrand } from '../services/card-input';
import { onlyWhenChanged } from '../services/changed-only';

import { AcceptedBrands } from './AcceptedBrands';
import styles from './AddCardForm.module.css';
import { CardNumberField } from './CardNumberField';
import { CardVisual } from './CardVisual';
import type { CardFocus } from './CardVisual';
import { ExpirySelects } from './ExpirySelects';
import { FormAlert } from './FormAlert';
import { SecurityNotice } from './SecurityNotice';
import { TermsDialog } from './TermsDialog';
import { TermsField } from './TermsField';

/**
 * Yerlesim (T17.1; F5): "page" Odeme Yontemlerim'in Kart Ekle sayfasi
 * (Guvenlik kutusu ve yaninda kart); "checkout" odeme penceresinin adimi
 * (Guvenlik kutusu YOK, kart animasyonu en ustte, tek sutun, kutusuz).
 * Parcalar ve kurallar AYNI; yalnizca yerlesim degisir.
 */
export type AddCardFormVariant = 'page' | 'checkout';

interface AddCardFormProps {
  readonly texts: PaymentMethodsContent;
  readonly variant?: AddCardFormVariant | undefined;
  /** Karti kaydeder (useAddCard); hata verirse firlatir. */
  readonly onSave: (request: AddCardRequest) => Promise<SavedCard>;
  /** Formun bir alani degisti (QA C3). */
  readonly onChanged: () => void;
  /** Kayit bitti: sayfa listeye doner ve bildirim gosterir. */
  readonly onSaved: (card: SavedCard) => void;
}

/** Kartin hangi yuzu ve cercevesi: alan -> kart bolgesi. */
type FormFocus = CardFocus | 'cvv';

const MASK = '•';
const DEFAULT_CVV_LENGTH = 3;

/**
 * Kart Ekle formu (T11.17; duzen kullanicinin referansi getircarsi "Kart
 * Ekle"; mantik useCardForm'da). Beyaz kutuda sirayla: Guvenlik kutusu, kart
 * adi, numara, kart uzerindeki isim, son kullanma (Ay, Yil) ve CVV, zorunlu
 * kosul onayi, Devam ve kabul edilen kartlar. Bizim ekstramiz tasarim B'nin
 * kart animasyonu: dar ekranda Guvenlik kutusunun altinda, genis ekranda
 * kutunun saginda yapiskan; canli guncellenir, CVV'de doner.
 *
 * Numara ve CVV YALNIZCA bu formun durumunda yasar (M7): kart gorseline
 * maskeli gider, onbellege yazilmaz; form kapaninca gider.
 */
export function AddCardForm({
  texts,
  variant = 'page',
  onSave,
  onChanged,
  onSaved,
}: AddCardFormProps) {
  const { form, values, formMessage, waitSeconds, submit } = useCardForm({
    texts,
    save: onSave,
    changed: onChanged,
    onSaved,
  });
  const { control, formState } = form;
  const [focus, setFocus] = useState<FormFocus>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const years = useMemo(() => cardExpiryYears(new Date()), []);
  const brand = typingBrand(values.number);
  const nickname = normalizeCardText(values.nickname);
  const cvvLength = brand === null ? DEFAULT_CVV_LENGTH : cvvLengthOf(brand);
  const leave = (onBlur: () => void) => () => {
    onBlur();
    setFocus(null);
  };

  return (
    <>
      <form
        className={
          variant === 'checkout'
            ? `${styles['c-add-card']} ${styles['c-add-card--checkout']}`
            : styles['c-add-card']
        }
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {variant === 'page' && (
          <SecurityNotice title={texts.securityTitle} text={texts.securityText} />
        )}
        <div className={styles['c-add-card__stage']}>
          <div className={styles['c-add-card__card']}>
            <CardVisual
              brand={brand}
              groups={typedCardFace(values.number, brand)}
              holderName={faceHolderName(values.holderName, texts.holderPlaceholder)}
              expiry={faceExpiry(values.expiryMonth, values.expiryYear, texts.expiryPlaceholder)}
              nickname={nickname === '' ? texts.nicknamePlaceholder : nickname}
              cvvMask={MASK.repeat(values.cvv === '' ? cvvLength : values.cvv.length)}
              texts={texts}
              flipped={focus === 'cvv'}
              focus={focus === 'cvv' ? null : focus}
            />
          </div>
        </div>
        {formMessage !== null && (
          <FormAlert
            message={formMessage}
            waitLabel={texts.retryWaitLabel}
            waitSeconds={waitSeconds}
          />
        )}
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
        <Controller
          name="number"
          control={control}
          render={({ field, fieldState }) => (
            <div className={styles['c-add-card__number']}>
              <CardNumberField
                fieldRef={field.ref}
                id="kart-numara"
                name={field.name}
                label={texts.numberLabel}
                value={field.value}
                onChange={field.onChange}
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
        <div className={styles['c-add-card__expiry-row']}>
          <p id="kart-skt-baslik" className={styles['c-add-card__expiry-title']}>
            {texts.expiryLegend}
          </p>
          <Controller
            name="expiryMonth"
            control={control}
            render={({ field: month, fieldState: monthState }) => (
              <Controller
                name="expiryYear"
                control={control}
                render={({ field: year, fieldState: yearState }) => (
                  <ExpirySelects
                    labelledBy="kart-skt-baslik"
                    monthLabel={texts.monthLabel}
                    yearLabel={texts.yearLabel}
                    years={years}
                    month={{
                      ...month,
                      id: 'kart-skt-ay',
                      onFocus: () => setFocus('expiry'),
                      onBlur: leave(month.onBlur),
                      invalid: monthState.error !== undefined,
                    }}
                    year={{
                      ...year,
                      id: 'kart-skt-yil',
                      onFocus: () => setFocus('expiry'),
                      onBlur: leave(year.onBlur),
                      invalid: yearState.error !== undefined,
                    }}
                    error={monthState.error?.message ?? yearState.error?.message}
                  />
                )}
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
                onChange={(event) =>
                  onlyWhenChanged(field.value, field.onChange)(cvvDigits(event.target.value, brand))
                }
                onFocus={() => setFocus('cvv')}
                onBlur={leave(field.onBlur)}
                error={fieldState.error?.message}
              />
            )}
          />
        </div>
        <Controller
          name="terms"
          control={control}
          render={({ field, fieldState }) => (
            <TermsField
              id="kart-kosullar"
              inputRef={field.ref}
              name={field.name}
              checked={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              linkLabel={texts.termsLinkLabel}
              suffix={texts.termsSuffix}
              onOpenTerms={() => setTermsOpen(true)}
              error={fieldState.error?.message}
            />
          )}
        />
        <button
          type="submit"
          className={styles['c-add-card__submit']}
          disabled={formState.isSubmitting || waitSeconds > 0}
          aria-busy={formState.isSubmitting}
        >
          {formState.isSubmitting ? texts.savingLabel : texts.saveLabel}
        </button>
        <AcceptedBrands
          label={texts.acceptedBrandsLabel}
          labels={texts.brandLabels}
          marks={texts.brandMarks}
          active={brand}
        />
      </form>
      {termsOpen && (
        <TermsDialog
          title={texts.termsTitle}
          paragraphs={texts.termsParagraphs}
          closeLabel={texts.closeLabel}
          onClose={() => setTermsOpen(false)}
        />
      )}
    </>
  );
}
