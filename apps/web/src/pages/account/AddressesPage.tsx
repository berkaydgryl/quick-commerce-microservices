import type { AddressKind, SavedAddress } from '@getir/contracts';
import { useState } from 'react';

import { useAddressBook } from '../../features/address/hooks/useAddressBook';
import { useDeleteAddress } from '../../features/address/hooks/useDeleteAddress';
import { useSavedAddresses } from '../../features/address/hooks/useSavedAddresses';
import { selectedAddress } from '../../features/address/services/delivery-address';
import { AddressSetupDialog } from '../../features/address/ui/AddressSetupDialog';
import { DeleteAddressDialog } from '../../features/address/ui/DeleteAddressDialog';
import { formFeedback } from '../../features/auth/services/server-errors';
import { RequireAuth } from '../../features/auth/ui/RequireAuth';
import { useAddressesContent } from '../../features/content/hooks/useAddressesContent';
import { useAppHeaderContent } from '../../features/content/hooks/useAppHeaderContent';
import { useSessionStore } from '../../shared/session/session-store';
import { useToastStore } from '../../shared/toast/toast-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

import { AccountLayout } from './AccountLayout';
import { AddressesView } from './AddressesView';

/** /hesabim/adreslerim (T11.15): korumali; adresler hesap sayfalarinin ortak icerik kabinda. */
export function AddressesPage() {
  return (
    <PageLayout>
      <RequireAuth>
        <SignedInAddresses />
      </RequireAuth>
    </PageLayout>
  );
}

/** Acik pencere: ekleme (turuyle), duzenleme ya da silme onayi. */
type AddressesDialog =
  | { readonly mode: 'add'; readonly kind: AddressKind }
  | { readonly mode: 'edit'; readonly address: SavedAddress }
  | { readonly mode: 'delete'; readonly address: SavedAddress };

function SignedInAddresses() {
  const userId = useSessionStore((state) => state.user?.id);
  return userId === undefined ? null : <AddressesSection userId={userId} />;
}

/**
 * Sayfa BIRLESTIRIR: liste (AddressesView, durumsuz), T11.8'in ekleme
 * penceresi (ekleme ve duzenleme modu) ve silme onayi. Secim ve gecerli
 * adres useAddressBook'ta (kimlikle); silinen secili adresin yerine defterin
 * ilk adresi gecer (K6). Son adres silinince ekleme penceresi acilir; X ile
 * kapanir (T6), ana sayfa adres kapisi zaten adres ister.
 */
function AddressesSection({ userId }: { readonly userId: string }) {
  const texts = useAddressesContent();
  const content = useAppHeaderContent();
  const book = useSavedAddresses(userId);
  const { delivery, choose } = useAddressBook();
  const removing = useDeleteAddress(userId);
  const show = useToastStore((state) => state.show);
  const [dialog, setDialog] = useState<AddressesDialog | undefined>();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const close = (): void => {
    setDialog(undefined);
    setDeleteError(null);
  };

  const remove = async (address: SavedAddress): Promise<void> => {
    setDeleteError(null);
    try {
      const left = await removing.mutateAsync(address.id);
      if (texts !== undefined) {
        show(`${address.title} ${texts.deletedToastSuffix}`);
      }
      const [first] = left.items;
      setDialog(first === undefined ? { mode: 'add', kind: 'HOME' } : undefined);
    } catch (error) {
      setDeleteError(formFeedback(error, []).message);
    }
  };

  const addresses = book.data;
  return (
    <AccountLayout userId={userId} variant="section">
      {texts !== undefined && (
        <AddressesView
          texts={texts}
          kinds={content?.addressSetup.kinds ?? []}
          addresses={addresses}
          error={book.error}
          onRetry={() => void book.refetch()}
          selectedId={selectedAddress(addresses ?? [], delivery)?.id}
          actionsDisabled={content === undefined}
          onSelect={(address) => choose(address.id)}
          onEdit={(address) => setDialog({ mode: 'edit', address })}
          onDelete={(address) => setDialog({ mode: 'delete', address })}
          onAdd={(kind) => setDialog({ mode: 'add', kind })}
        />
      )}
      {texts !== undefined && dialog?.mode === 'delete' && (
        <DeleteAddressDialog
          texts={texts}
          address={dialog.address}
          pending={removing.isPending}
          error={deleteError}
          onConfirm={() => void remove(dialog.address)}
          onCancel={close}
        />
      )}
      {texts !== undefined && content !== undefined && dialog?.mode === 'edit' && (
        <AddressSetupDialog
          content={content.addressSetup}
          closeLabel={content.closeLabel}
          userId={userId}
          onClose={close}
          closableOnDetails
          onSaved={() => {
            show(texts.updatedToast);
            close();
          }}
          editing={{
            address: dialog.address,
            title: texts.editTitle,
            deleteLabel: texts.deleteLabel,
            onDelete: () => setDialog({ mode: 'delete', address: dialog.address }),
          }}
        />
      )}
      {content !== undefined && dialog?.mode === 'add' && (
        <AddressSetupDialog
          content={content.addressSetup}
          closeLabel={content.closeLabel}
          userId={userId}
          onClose={close}
          closableOnDetails
          onSaved={close}
          initialKind={dialog.kind}
        />
      )}
    </AccountLayout>
  );
}
