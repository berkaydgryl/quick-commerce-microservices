import type { SavedCard } from '@getir/contracts';
import { Link, useNavigate } from 'react-router-dom';

import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useAddCard } from '../../features/cards/hooks/useAddCard';
import { PAYMENT_METHODS_PATH } from '../../features/cards/routes';
import { cardShortName, cardSpokenName } from '../../features/cards/services/card-face';
import { AddCardForm } from '../../features/cards/ui/AddCardForm';
import { usePaymentMethodsContent } from '../../features/content/hooks/usePaymentMethodsContent';
import { ChevronLeftIcon } from '../../features/profile/ui/icons';
import { useSessionStore } from '../../shared/session/session-store';
import { useToastStore } from '../../shared/toast/toast-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import styles from './AddCardPage.module.css';

/** /hesabim/odeme-yontemlerim/ekle (T11.17, M5): korumali; kart ekle formu. */
export function AddCardPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInAddCard />
      </RequireAuth>
    </PageLayout>
  );
}

function SignedInAddCard() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : <AddCardSection userId={userId} />;
}

/**
 * Sayfa BAGLAR (referans getircarsi "Kart Ekle"): ustte "‹ Ödeme
 * Yöntemlerim'e geri dön", baslik "Kart Ekle", altinda form kutusu. Kayit
 * bitince listeye doner ve bildirim cikar ("Kart eklendi: Visa •••• 4242");
 * form kapandigi icin numara ve CVV bellekte kalmaz (M7).
 */
function AddCardSection({ userId }: { readonly userId: string }) {
  const texts = usePaymentMethodsContent();
  const { save, changed } = useAddCard(userId);
  const navigate = useNavigate();
  const show = useToastStore((state) => state.show);

  const saved = (card: SavedCard): void => {
    if (texts !== undefined) {
      show(
        `${texts.addedToastPrefix} ${cardShortName(card, texts.brandLabels)}`,
        `${texts.addedToastPrefix} ${cardSpokenName(card, texts.brandLabels, texts.lastFourLabel)}`,
      );
    }
    void navigate(PAYMENT_METHODS_PATH);
  };

  return (
    <AccountLayout userId={userId} variant="nested">
      {texts !== undefined && (
        <section className={styles['c-add-card-page']} aria-labelledby="kart-ekle-baslik">
          <Link to={PAYMENT_METHODS_PATH} className={styles['c-add-card-page__back']}>
            <span className={styles['c-add-card-page__back-icon']}>
              <ChevronLeftIcon />
            </span>
            {texts.backToListLabel}
          </Link>
          <h1 id="kart-ekle-baslik" className={styles['c-add-card-page__title']}>
            {texts.addTitle}
          </h1>
          <AddCardForm texts={texts} onSave={save} onChanged={changed} onSaved={saved} />
        </section>
      )}
    </AccountLayout>
  );
}
