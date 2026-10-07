import styles from './ClosedMarketNotice.module.css';

interface ClosedMarketNoticeProps {
  /** Pasif "+" dugmeleri bu kimlige baglanir (aria-describedby). */
  readonly id: string;
  readonly text: string;
}

/**
 * Kapali marketin sebep satiri (07.10 kullanici istegi): "Market şu an
 * kapalı". Magaza sayfasinda urunlerin ustunde, aramada marketin kartinda
 * TEK satir; her "+" ona baglidir (kart basina tekrar yok).
 */
export function ClosedMarketNotice({ id, text }: ClosedMarketNoticeProps) {
  return (
    <p id={id} className={styles['c-closed-market-notice']}>
      {text}
    </p>
  );
}
