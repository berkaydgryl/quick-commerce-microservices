import { forwardRef, useState } from 'react';

import { AuthField } from './AuthField';
import type { AuthFieldProps } from './AuthField';
import styles from './PasswordField.module.css';
import { EyeIcon, EyeOffIcon, LockIcon } from './icons';

type PasswordFieldProps = Omit<AuthFieldProps, 'type' | 'icon' | 'action' | 'prefix'>;

/** Sifre alani: kilit ikonu ve "goster / gizle" dugmesi (referans ekran). */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <AuthField
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        icon={<LockIcon />}
        action={
          <button
            type="button"
            className={styles['c-password-toggle']}
            aria-label="Şifreyi göster"
            aria-pressed={visible}
            aria-controls={props.id}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        }
      />
    );
  },
);
