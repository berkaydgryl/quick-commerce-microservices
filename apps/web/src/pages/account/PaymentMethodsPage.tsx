import type { SavedCard } from '@getir/contracts';
import { useState } from 'react';

import { formFeedback } from '../../features/auth/services/server-errors';
import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useDeleteCard } from '../../features/cards/hooks/useDeleteCard';
import { useSavedCards } from '../../features/cards/hooks/useSavedCards';
import { ADD_CARD_PATH } from '../../features/cards/routes';
import { cardShortName } from '../../features/cards/services/card-face';
import { DeleteCardDialog } from '../../features/cards/ui/DeleteCardDialog';
import { usePaymentMethodsContent } from '../../features/content/hooks/usePaymentMethodsContent';
import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { useSessionStore } from '../../shared/session/session-store';
import { useToastStore } from '../../shared/toast/toast-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import { PaymentMethodsView } from './PaymentMethodsView';

/** /hesabim/odeme-yontemlerim (T11.17): korumali; kartlar hesap sayfalarinin ortak icerik kabinda. */
export function PaymentMethodsPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInPaymentMethods />
      </RequireAuth>
    </PageLayout>
  );
}

function SignedInPaymentMethods() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : <PaymentMethodsSection userId={userId} />;
}

/**
 * Sayfa BIRLESTIRIR: liste (PaymentMethodsView, durumsuz) ve silme onayi.
 * Silinince guncel liste onbellege yazilir ve bildirim cikar ("Visa •••• 4242
 * kartı silindi.").
 */
function PaymentMethodsSection({ userId }: { readonly userId: string }) {
  const texts = usePaymentMethodsContent();
  const { data: content } = useWelcomeContent();
  const cards = useSavedCards(userId);
  const removing = useDeleteCard(userId);
  const show = useToastStore((state) => state.show);
  const [deleting, setDeleting] = useState<SavedCard | undefined>();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const close = (): void => {
    setDeleting(undefined);
    setDeleteError(null);
  };

  const remove = async (card: SavedCard): Promise<void> => {
    setDeleteError(null);
    try {
      await removing.mutateAsync(card.id);
      if (texts !== undefined) {
        show(`${cardShortName(card, texts.brandLabels)} ${texts.deletedToastSuffix}`);
      }
      close();
    } catch (error) {
      setDeleteError(formFeedback(error, []).message);
    }
  };

  return (
    <AccountLayout userId={userId} variant="section">
      {texts !== undefined && (
        <PaymentMethodsView
          texts={texts}
          cards={cards.data}
          error={cards.error}
          onRetry={() => void cards.refetch()}
          addHref={ADD_CARD_PATH}
          actionsDisabled={content === undefined}
          onDelete={(card) => setDeleting(card)}
        />
      )}
      {texts !== undefined && content !== undefined && deleting !== undefined && (
        <DeleteCardDialog
          texts={texts}
          closeLabel={content.loginCard.closeLabel}
          card={deleting}
          pending={removing.isPending}
          error={deleteError}
          onConfirm={() => void remove(deleting)}
          onCancel={close}
        />
      )}
    </AccountLayout>
  );
}
