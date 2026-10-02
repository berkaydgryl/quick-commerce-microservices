import type { FeatureContent } from '@getir/contracts';

import { PageContainer } from '../../shared/ui/page-container/PageContainer';

import styles from './WelcomeFeatures.module.css';

/**
 * Tanitim kutulari (T11.7; referans: getir.com): beyaz kutularda gorsel ve mor
 * metin. Gorsel suslemedir (anlam metindedir, alt metni bos). Telefonda alt
 * alta, genis ekranda yan yana. Icerik ucundan gelir.
 */
export function WelcomeFeatures({ features }: { readonly features: readonly FeatureContent[] }) {
  return (
    <div className={styles['c-welcome-features']}>
      <PageContainer wide>
        <ul role="list" className={styles['c-welcome-features__list']}>
          {features.map((feature) => (
            <li key={feature.text} className={styles['c-welcome-features__card']}>
              <img
                className={styles['c-welcome-features__image']}
                src={feature.image.url}
                width={feature.image.width}
                height={feature.image.height}
                alt=""
                loading="lazy"
              />
              <p className={styles['c-welcome-features__text']}>{feature.text}</p>
            </li>
          ))}
        </ul>
      </PageContainer>
    </div>
  );
}
