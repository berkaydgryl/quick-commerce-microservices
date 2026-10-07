import { useId } from 'react';

import styles from './TextAreaField.module.css';

interface TextAreaFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Karakter siniri: alan fazlasini almaz, sayac "12/250" gosterir. */
  readonly maxLength: number;
  readonly placeholder?: string | undefined;
}

/**
 * Cok satirli metin alani ve sayaci (T17.1; referans getircarsi "0/250"):
 * etiket ustte, sayac sag altta. Sayac alana aria-describedby ile baglidir
 * (her tusta duyurulmaz; alana gelince okunur).
 */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  maxLength,
  placeholder,
}: TextAreaFieldProps) {
  const counterId = useId();
  return (
    <div className={styles['c-text-area']}>
      <label htmlFor={id} className={styles['c-text-area__label']}>
        {label}
      </label>
      <textarea
        id={id}
        className={styles['c-text-area__input']}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={counterId}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={counterId} className={styles['c-text-area__counter']}>
        {value.length}/{maxLength}
      </span>
    </div>
  );
}
