import type { WelcomeContent } from '@getir/contracts';
import type { ReactNode } from 'react';

import { PageContainer } from '../../shared/ui/page-container/PageContainer';

import styles from './WelcomeHero.module.css';

interface WelcomeHeroProps {
  readonly hero: WelcomeContent['hero'];
  /** Giris karti. */
  readonly children: ReactNode;
}

/**
 * Banner katmani (T11.6). Slogan gorselin icinde yazilidir (2 Ekim karari):
 * sayfanin h1'i gorselin kendisidir, adini alt metni (icerikteki baslik)
 * verir; uste ayrica metin cizilmez, karartma yoktur.
 *
 * Duzen (CSS): telefonda ve 1440 px'e kadar gorsel kendi oraninda ustte, kart
 * altta. 1440 px ve ustunde kart gorselin sagina biner, ust barin sag kenariyla
 * hizali (genis kapsayici); daha darda afisin yazisini kapatirdi.
 */
export function WelcomeHero({ hero, children }: WelcomeHeroProps) {
  const { banner } = hero;
  const smallest = banner.sources[0];
  return (
    <section className={styles['c-welcome-hero']}>
      <h1 className={styles['c-welcome-hero__title']}>
        <img
          className={styles['c-welcome-hero__image']}
          src={smallest?.url}
          srcSet={banner.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
          sizes="100vw"
          width={banner.width}
          height={banner.height}
          alt={hero.title}
        />
      </h1>
      <div className={styles['c-welcome-hero__card']}>
        <PageContainer wide>
          <div className={styles['c-welcome-hero__slot']}>{children}</div>
        </PageContainer>
      </div>
    </section>
  );
}
