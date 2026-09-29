import type { LoginCredentials } from '../ui/LoginForm';

import styles from './DemoPersonaPicker.module.css';
import { DEMO_PASSWORD, DEMO_PERSONAS, RISK_BAND_LABELS } from './personas';

interface DemoPersonaPickerProps {
  readonly onPick: (credentials: LoginCredentials) => void;
}

/**
 * Gelistirme icin persona secici (T8.5): formu personanin telefonu ve demo
 * sifresiyle DOLDURUR; girisi kullanici yapar (hata ve sinir yolu da denenir).
 * Production paketine girmez (bkz. personas.ts).
 */
export function DemoPersonaPicker({ onPick }: DemoPersonaPickerProps) {
  return (
    <section className={styles['c-demo-personas']} aria-labelledby="demo-personalar">
      <h2 id="demo-personalar" className={styles['c-demo-personas__title']}>
        Demo personalar
      </h2>
      <p className={styles['c-demo-personas__note']}>
        Yalnızca geliştirmede görünür. Seçtiğin persona formu doldurur, girişi sen yaparsın.
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
    </section>
  );
}
