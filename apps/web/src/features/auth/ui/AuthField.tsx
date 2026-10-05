import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

import styles from './AuthField.module.css';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'prefix' | 'className' | 'aria-invalid' | 'aria-describedby'
>;

export interface AuthFieldProps extends NativeInputProps {
  readonly id: string;
  /** Kutunun icinde, degerin ustunde duran etiket (referans ekran). */
  readonly label: string;
  /** Alanin altindaki hata; varsa alan gecersiz isaretlenir. */
  readonly error?: string | undefined;
  /** Sabit onek ("+90"): degerin parcasi gibi okunur, ekran okuyucu da duyar. */
  readonly prefix?: string;
  /** Soldaki suslemeli ikon (kilit). */
  readonly icon?: ReactNode;
  /** Sagdaki eylem (sifreyi goster dugmesi). */
  readonly action?: ReactNode;
  /**
   * Yuzen etiket (T11.16, telefon alanlari): alan bosken etiket kutunun
   * icinde ipucu boyunda durur (odakta da), deger girilince uste kucuk kayar.
   * Ipucu metni kullanilmaz; etiket her durumda gercek <label>'dir.
   */
  readonly floatingLabel?: boolean;
}

/**
 * Yuzen etiketin ipucu: bosluk. Gorunmez; yalnizca CSS'in :placeholder-shown
 * ile "alan bos" durumunu tanimasi icin (ekran okuyucu <label>'i okur).
 */
const FLOATING_PLACEHOLDER = ' ';

/**
 * Kimlik formlarinin alani (T8.5): cerceve inputun KENDISIDIR; etiket, onek ve
 * ikon onun ustune yerlesir. Odak halkasi boylece kutunun tamamini sarar
 * (global :focus-visible; kaldirilmaz).
 */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { id, label, error, prefix, icon, action, floatingLabel = false, ...input },
  ref,
) {
  const prefixId = `${id}-onek`;
  const errorId = `${id}-hata`;
  const describedBy = [prefix === undefined ? null : prefixId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(' ');
  const modifiers = [
    prefix === undefined ? null : styles['c-auth-field--prefixed'],
    icon === undefined ? null : styles['c-auth-field--with-icon'],
    action === undefined ? null : styles['c-auth-field--with-action'],
    floatingLabel ? styles['c-auth-field--floating'] : null,
  ].filter((modifier) => modifier != null);

  return (
    <div className={[styles['c-auth-field'], ...modifiers].join(' ')}>
      <div className={styles['c-auth-field__control']}>
        <input
          ref={ref}
          id={id}
          className={styles['c-auth-field__input']}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          {...input}
          placeholder={floatingLabel ? FLOATING_PLACEHOLDER : input.placeholder}
        />
        <label htmlFor={id} className={styles['c-auth-field__label']}>
          {label}
        </label>
        {prefix !== undefined && (
          <span id={prefixId} className={styles['c-auth-field__prefix']}>
            {prefix}
          </span>
        )}
        {icon !== undefined && <span className={styles['c-auth-field__icon']}>{icon}</span>}
        {action}
      </div>
      {error !== undefined && (
        <p id={errorId} className={styles['c-auth-field__error']}>
          {error}
        </p>
      )}
    </div>
  );
});
