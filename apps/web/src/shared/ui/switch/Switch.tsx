import styles from './Switch.module.css';

interface SwitchProps {
  /** Anahtarin erisilebilir adi: "Hediye olarak gönder". */
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Yaninda gorunen durum: "Evet" / "Hayır" (ekran okuyucu durumu aria-checked'ten alir). */
  readonly onText: string;
  readonly offText: string;
}

/**
 * Acik/kapali anahtari (T17.1; referans getircarsi "Hediye Bilgileri Evet/Hayır"):
 * role="switch" dugme; Space ve Enter dugmenin kendi davranisi. Hareket
 * azaltmada kayma yok.
 */
export function Switch({ label, checked, onChange, onText, offText }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? `${styles['c-switch']} ${styles['is-on']}` : styles['c-switch']}
      onClick={() => onChange(!checked)}
    >
      <span className={styles['c-switch__state']} aria-hidden="true">
        {checked ? onText : offText}
      </span>
      <span className={styles['c-switch__track']} aria-hidden="true">
        <span className={styles['c-switch__thumb']} />
      </span>
    </button>
  );
}
