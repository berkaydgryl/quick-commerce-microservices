import type { AppDownloadContent } from '@getir/contracts';
import { useId } from 'react';

import { PageContainer } from '../../shared/ui/page-container/PageContainer';

import styles from './WelcomeAppDownload.module.css';

/**
 * Uygulama indirme bandi (T11.7; referans: getir.com "Getir'i indir!"):
 * acik zeminde, kapsayici genisliginde mor kutu. Solda baslik, alt metin ve
 * magaza rozetleri; sagda telefon gorseli, kutunun ic boslugunda saga ve alta
 * yasli. Rozetler magaza sayfasini yeni sekmede acar (noopener). Metin, gorsel
 * ve baglantilar icerik ucundan gelir.
 */
export function WelcomeAppDownload({ content }: { readonly content: AppDownloadContent }) {
  const titleId = useId();
  return (
    <section className={styles['c-welcome-download']} aria-labelledby={titleId}>
      <PageContainer wide>
        <div className={styles['c-welcome-download__box']}>
          <div className={styles['c-welcome-download__text']}>
            <h2 id={titleId} className={styles['c-welcome-download__title']}>
              {content.title}
            </h2>
            <p className={styles['c-welcome-download__subtitle']}>{content.subtitle}</p>
            <ul role="list" className={styles['c-welcome-download__stores']}>
              {content.stores.map((store) => (
                <li key={store.url}>
                  <a
                    href={store.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles['c-welcome-download__store']}
                  >
                    <img
                      className={styles['c-welcome-download__badge']}
                      src={store.badge.url}
                      width={store.badge.width}
                      height={store.badge.height}
                      alt={store.label}
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <img
            className={styles['c-welcome-download__image']}
            src={content.image.url}
            width={content.image.width}
            height={content.image.height}
            alt=""
            loading="lazy"
          />
        </div>
      </PageContainer>
    </section>
  );
}
