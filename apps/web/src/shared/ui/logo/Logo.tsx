import styles from './Logo.module.css';

interface LogoProps {
  /**
   * Logonun iki parcasi: "getir" + "market". Icerikten gelir (karsilama barinda
   * T11.6, ust barda T11.10 duzeltmesi); kodda sabit metin yok.
   */
  readonly brand: string;
  readonly service: string;
  /** "inverse": mor zemin (karsilama, giris, kayit ekraninin ust bari): marka sari, servis beyaz. */
  readonly tone?: 'brand' | 'inverse';
  /** "stacked": marka ustte, servis altta (Yukleniyor gostergesinin dairesi, F18). */
  readonly layout?: 'inline' | 'stacked';
}

/**
 * Yazi logosu: "getir" + "market" (T11.6'dan beri rozetsiz: kullanicinin
 * karari, "logomuz bu kadar"). Gorsel dosya yerine yazi tipiyle cizilir;
 * renkler token'dan gelir, boyut cevresindeki yazi boyutunu izler. Beyaz
 * zeminde marka mor, servis koyu mor; mor zeminde marka sari, servis beyaz.
 */
export function Logo({ brand, service, tone = 'brand', layout = 'inline' }: LogoProps) {
  const className = [
    styles['c-logo'],
    tone === 'inverse' ? styles['c-logo--inverse'] : '',
    layout === 'stacked' ? styles['c-logo--stacked'] : '',
  ]
    .filter(Boolean)
    .join(' ');
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
