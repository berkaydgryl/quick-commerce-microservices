import styles from './Logo.module.css';

interface LogoProps {
  /** Logonun iki parcasi: "getir" + "market". Karsilama ekrani icerikten verir (T11.6). */
  readonly brand?: string;
  readonly service?: string;
  /** "inverse": mor zemin (karsilama, giris, kayit ekraninin ust bari): marka sari, servis beyaz. */
  readonly tone?: 'brand' | 'inverse';
}

/**
 * Yazi logosu: "getir" + "market" (T11.6'dan beri rozetsiz: kullanicinin
 * karari, "logomuz bu kadar"). Gorsel dosya yerine yazi tipiyle cizilir;
 * renkler token'dan gelir, boyut cevresindeki yazi boyutunu izler. Beyaz
 * zeminde marka mor, servis koyu mor; mor zeminde marka sari, servis beyaz.
 */
export function Logo({ brand = 'getir', service = 'market', tone = 'brand' }: LogoProps) {
  const className =
    tone === 'inverse' ? `${styles['c-logo']} ${styles['c-logo--inverse']}` : styles['c-logo'];
  return (
    <span className={className} role="img" aria-label={`${brand}${service}`}>
      <span className={styles['c-logo__brand']} aria-hidden="true">
        {brand}
      </span>
      <span className={styles['c-logo__service']} aria-hidden="true">
        {service}
      </span>
    </span>
  );
}
