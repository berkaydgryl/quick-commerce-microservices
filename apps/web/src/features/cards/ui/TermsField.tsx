import { useId } from 'react';
import type { FocusEventHandler, Ref } from 'react';

import styles from './TermsField.module.css';

interface TermsFieldProps {
  readonly id: string;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly name: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly onBlur: FocusEventHandler<HTMLInputElement>;
  /** "Kullanım Koşulları" baglantisi ve arkasindaki "'nı okudum, kabul ediyorum.". */
  readonly linkLabel: string;
  readonly suffix: string;
  /** Baglanti: kart saklama kosullari penceresini acar. */
  readonly onOpenTerms: () => void;
  readonly error: string | undefined;
}

/**
 * Zorunlu kosul onayi (T11.17; referans getircarsi "Kullanım Koşulları'nı
 * okudum, kabul ediyorum."). Onay kutusu ve etiket; etiketin icindeki
 * "Kullanım Koşulları" bir dugmedir: kisa kosullar penceresini acar (ayri
 * sayfa yok). Isaretlenmeden Devam olmaz (form semasi). Kutunun erisilebilir
 * adi tek parca cumle (aria-label, QA D1 ve K5): "Kullanım Koşulları'nı
 * okudum, kabul ediyorum." (iki kimlik birlesince arada bosluk kalir ve
 * kopuk okunurdu); etiket tiklamayi kutuya tasir.
 */
export function TermsField({
  id,
  inputRef,
  name,
  checked,
  onChange,
  onBlur,
  linkLabel,
  suffix,
  onOpenTerms,
  error,
}: TermsFieldProps) {
  const errorId = useId();
  return (
    <div className={styles['c-terms']}>
      <div className={styles['c-terms__row']}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="checkbox"
          className={styles['c-terms__box']}
          checked={checked}
          aria-label={`${linkLabel}${suffix}`}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => onChange(event.target.checked)}
          onBlur={onBlur}
        />
        <span className={styles['c-terms__text']}>
          <button type="button" className={styles['c-terms__link']} onClick={onOpenTerms}>
            {linkLabel}
          </button>
          <label htmlFor={id}>{suffix}</label>
        </span>
      </div>
      {error !== undefined && (
        <p id={errorId} className={styles['c-terms__error']}>
          {error}
        </p>
      )}
    </div>
  );
}
