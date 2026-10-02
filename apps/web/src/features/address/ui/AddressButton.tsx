import type { ButtonHTMLAttributes } from 'react';

import styles from './AddressButton.module.css';

type AddressButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/**
 * Adres penceresinin ana dugmesi (T11.8; referans: mor zemin, beyaz yazi):
 * "Bu adresi kullan" ve "Kaydet". Pasifken soluk.
 */
export function AddressButton({ type = 'button', ...button }: AddressButtonProps) {
  return <button type={type} className={styles['c-address-button']} {...button} />;
}
