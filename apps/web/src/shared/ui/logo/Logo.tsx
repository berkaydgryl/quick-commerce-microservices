import styles from './Logo.module.css';

/**
 * Yazi logosu: "getir" + "market" ve sari sepet rozeti. Gorsel dosya yerine
 * yazi tipiyle cizilir; renkler token'dan gelir, boyut cevresindeki yazi
 * boyutunu izler (rozet em ile olculur).
 */
export function Logo() {
  return (
    <span className={styles['c-logo']} role="img" aria-label="getirmarket">
      <span className={styles['c-logo__word']} aria-hidden="true">
        getir<span className={styles['c-logo__word--strong']}>market</span>
      </span>
      <span className={styles['c-logo__badge']} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M3 4h2.5l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.4" />
          <circle cx="9.5" cy="19.5" r="1.4" />
          <circle cx="17" cy="19.5" r="1.4" />
        </svg>
      </span>
    </span>
  );
}
