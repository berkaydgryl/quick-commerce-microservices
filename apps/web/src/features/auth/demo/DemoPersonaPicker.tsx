import type { LoginCredentials } from '../ui/LoginForm';

import styles from './DemoPersonaPicker.module.css';
import { DEMO_PASSWORD, DEMO_PERSONAS, RISK_BAND_LABELS } from './personas';

interface DemoPersonaPickerProps {
  readonly onPick: (credentials: LoginCredentials) => void;
  /**
   * true: liste acilir menu olarak asagi tasar (karsilama karti: kart uzarsa
   * banner buyur ve afisin yazisi kartin altina kayardi). false: yerinde acilir
   * (giris penceresi; pencere kendi icinde kayar).
   */
  readonly floating?: boolean;
}

/**
 * Gelistirme icin demo hesaplar (T8.5; T11.6'dan beri karsilama kartinin ve
 * giris penceresinin altinda katlanir liste): secilen persona telefonu ve demo
 * sifresini DOLDURUR; girisi kullanici yapar (hata ve sinir yolu da denenir).
 * Production paketine girmez (bkz. personas.ts); metinleri bu yuzden icerik
 * ucunda degil burada.
 */
export function DemoPersonaPicker({ onPick, floating = false }: DemoPersonaPickerProps) {
  const className = floating
    ? `${styles['c-demo-personas']} ${styles['c-demo-personas--floating']}`
    : styles['c-demo-personas'];
  return (
    <details className={className}>
      <summary className={styles['c-demo-personas__summary']}>Demo hesaplar</summary>
      <div className={styles['c-demo-personas__body']}>
        <p className={styles['c-demo-personas__note']}>
          Yalnızca geliştirmede görünür. Seçtiğin hesap formu doldurur, girişi sen yaparsın.
        </p>
        <ul role="list" className={styles['c-demo-personas__list']}>
          {DEMO_PERSONAS.map((persona) => (
            <li key={persona.phone}>
              <button
                type="button"
                className={styles['c-demo-personas__button']}
                onClick={() => onPick({ phone: persona.phone, password: DEMO_PASSWORD })}
              >
                <span className={styles['c-demo-personas__name']}>{persona.persona}</span>
                <span className={styles['c-demo-personas__band']}>
                  {RISK_BAND_LABELS[persona.band]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
