import type { ReactNode } from 'react';

import styles from './OrderCard.module.css';

interface OrderCardProps {
  /** Kartin ogesi: basligi olan bolum ya da tanim listesi (tarih, adres, tutarlar). */
  readonly as?: 'section' | 'dl';
  /** Bolumun basliginin kimligi (as="section"). */
  readonly labelledBy?: string;
  readonly children: ReactNode;
}

/**
 * Siparis kartinin kabugu (T11.16; F17'de ortak): beyaz kart. Siparis detayi
 * ve onay ekrani ayni karti kullanir; icerigin duzeni kartin icindeki
 * bilesende (OrderLines, OrderTotals).
 */
export function OrderCard({ as: Element = 'section', labelledBy, children }: OrderCardProps) {
  return (
    <Element className={styles['c-order-card']} aria-labelledby={labelledBy}>
      {children}
    </Element>
  );
}
