import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { Logo } from '../logo/Logo';

import styles from './AppLoader.module.css';

interface AppLoaderProps {
  /** Logonun iki parcasi ("getir", "market") ve "Yükleniyor..."; icerikten ya da yedekten. */
  readonly brand: string;
  readonly service: string;
  readonly label: string;
}

const graphemes = new Intl.Segmenter('tr', { granularity: 'grapheme' });

/** Yazinin harfleri: kullanicinin gordugu karakter (birlesik isaretler ve emoji tek parca). */
export function loaderLetters(label: string): readonly string[] {
  return Array.from(graphemes.segment(label), (part) => part.segment);
}

/**
 * Tam ekran Yukleniyor gostergesi (F18; PM S3 a): karartilmis zemin ustunde
 * beyaz kutu (onay penceresinin dili); icinde ince siyah cerceveli mor daire
 * ve ust uste logo (sari "getir", beyaz "market"; ortak Logo); altinda harf
 * harf yazilan "Yükleniyor..." (dongu: harfler sirayla belirir, yazi tam
 * kalir, hepsi birden silinir ve bastan yazilir; hareket azaltmada tam ve
 * sabit). Durum bolgesi (role="status") bos acilir, metin ardindan yazilir:
 * ekran okuyucu degisikligi bir kez okur. Harfler ve daire aria-hidden.
 * Ne zaman gorunecegi cagiranda (useLoaderVisible).
 */
export function AppLoader({ brand, service, label }: AppLoaderProps) {
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    setSpoken(label);
  }, [label]);
  const letters = loaderLetters(label);
  return (
    <div className={styles['c-app-loader']}>
      <div className={styles['c-app-loader__box']}>
        <span className={styles['c-app-loader__disc']} aria-hidden="true">
          <Logo brand={brand} service={service} tone="inverse" layout="stacked" />
        </span>
        <p className={styles['c-app-loader__label']}>
          <span className={styles['c-app-loader__spoken']} role="status">
            {spoken}
          </span>
          <span
            aria-hidden="true"
            className={styles['c-app-loader__typed']}
            style={{ '--c-app-loader-count': letters.length } as CSSProperties}
          >
            {letters.map((letter, index) => (
              <span
                // Harf yazidaki yerinden tanimlanir; sirasi gecikmeyi verir (CSS: yazma suresi x sira / harf sayisi).
                key={index}
                className={styles['c-app-loader__letter']}
                style={{ '--c-app-loader-index': index } as CSSProperties}
              >
                {letter}
              </span>
            ))}
          </span>
        </p>
      </div>
    </div>
  );
}
