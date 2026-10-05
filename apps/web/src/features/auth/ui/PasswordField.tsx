import { forwardRef, useState } from 'react';

import { AuthField } from './AuthField';
import type { AuthFieldProps } from './AuthField';
import styles from './PasswordField.module.css';
import { EyeIcon, EyeOffIcon, LockIcon } from './icons';

/** Goz dugmesinin adlari, duruma gore (icerikten; T11.16 duzeltmesi). */
interface PasswordToggleLabels {
  /** Sifre gizliyken: "Şifreyi göster". */
  readonly showLabel: string;
  /** Sifre gorunurken: "Şifreyi gizle". */
  readonly hideLabel: string;
}

type PasswordFieldProps = Omit<AuthFieldProps, 'type' | 'icon' | 'action' | 'prefix'> &
  PasswordToggleLabels;

interface PasswordToggleProps extends PasswordToggleLabels {
  readonly visible: boolean;
  readonly controls: string;
  readonly onToggle: () => void;
}

/**
 * Goz dugmesi (T11.16 duzeltmesi, kullanici istegi). Simge DURUMU gosterir:
 * sifre gorunurken acik goz, gizliyken ustu cizili goz. Ad bir sonraki eylemi
 * soyler ("Şifreyi göster" / "Şifreyi gizle"); aria-pressed YOK: adi durumla
 * degisen dugmede durum ikinci kez verilirse "Şifreyi gizle, basili" ters
 * anlasilir (WAI-ARIA dugme kalibi).
 */
export function PasswordToggle({
  visible,
  showLabel,
  hideLabel,
  controls,
  onToggle,
}: PasswordToggleProps) {
  return (
    <button
      type="button"
      className={styles['c-password-toggle']}
      aria-label={visible ? hideLabel : showLabel}
      aria-controls={controls}
      onClick={onToggle}
    >
      {visible ? <EyeIcon /> : <EyeOffIcon />}
    </button>
  );
}

/**
 * Sifre alani: kilit ikonu ve goz dugmesi (referans ekran). Butun sifre
 * alanlari bunu kullanir: giris, kayit, sifremi unuttum, profilde telefon
 * degistirme.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ showLabel, hideLabel, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <AuthField
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        icon={<LockIcon />}
        action={
          <PasswordToggle
            visible={visible}
            showLabel={showLabel}
            hideLabel={hideLabel}
            controls={props.id}
            onToggle={() => setVisible((current) => !current)}
          />
        }
      />
    );
  },
);
