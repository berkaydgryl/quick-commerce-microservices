import { PageContainer } from '../page-container/PageContainer';

import styles from './SiteFooter.module.css';

/**
 * Sayfa alt bilgisi (T16.3; referans getircarsi sepet sayfasi): beyaz bantta
 * telif satiri. Sosyal ikonlar ve bilgi baglantisi gercek adresler verilene
 * kadar yok (PM karari L6: adressiz ikon ya da baglanti cizilmez).
 */
export function SiteFooter({ copyright }: { readonly copyright: string }) {
  return (
    <footer className={styles['c-site-footer']}>
      <PageContainer wide>
        <p className={styles['c-site-footer__copyright']}>{copyright}</p>
      </PageContainer>
    </footer>
  );
}
