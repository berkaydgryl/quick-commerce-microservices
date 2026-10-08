import type { AddressSetupContent, AppHeaderContent } from '@getir/contracts';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import type { AddressBook } from '../hooks/useAddressBook';
import { selectedAddress } from '../services/delivery-address';

import { AddressBookDialog } from './AddressBookDialog';
import styles from './AddressDialogs.module.css';
import { AddressSetupDialog } from './AddressSetupDialog';

/** Acik pencere: "Adreslerim" listesi ya da "Adres Ekle" (harita + detay). */
export type AddressDialog = 'book' | 'add';

interface AddressDialogsProps {
  /** Adres defteri: cagiran tek gozlemciyle okur ve verir (T9.5 dersi). */
  readonly book: AddressBook;
  readonly content: AppHeaderContent;
  readonly setup: AddressSetupContent;
  readonly closeLabel: string;
  readonly userId: string;
  readonly open: AddressDialog;
  readonly onOpen: (dialog: AddressDialog) => void;
  readonly onClose: () => void;
}

/**
 * "Adreslerim" ve "Adres Ekle" pencereleri (T11.10; T11.13'ten beri ortak):
 * ust bardaki adres secici ve profil sayfasinin menusu ayni pencereleri
 * acar. "Adresi Onayla" secilen adresi gecerli yapar; "Adres Ekle" T11.8'in
 * penceresine gecer, kaydedince yeni adres secilir. Ikisi de adres degisiminin
 * bekcisinden gecer (F16).
 */
export function AddressDialogs({
  book,
  content,
  setup,
  closeLabel,
  userId,
  open,
  onOpen,
  onClose,
}: AddressDialogsProps) {
  const { delivery, addresses, error, retry, choose } = book;

  if (open === 'add') {
    return (
      <AddressSetupDialog
        content={setup}
        closeLabel={closeLabel}
        userId={userId}
        onClose={onClose}
        closableOnDetails
        onSaved={onClose}
      />
    );
  }

  const current = selectedAddress(addresses, delivery);
  // Defter okunurken (oturum ya da defter cozuluyor) bos liste ve pasif
  // "Onayla" yerine yukleniyor notu (QA W3); defter okunamadiysa hata.
  const loading = <QueryLoading>{content.addressLoadingLabel}</QueryLoading>;
  const notice =
    delivery.status === 'pending' ? (
      loading
    ) : delivery.source === 'account' ? undefined : delivery.reason === 'unavailable' ? (
      error === null ? (
        loading
      ) : (
        <QueryError error={error} onRetry={retry} />
      )
    ) : (
      <p className={styles['c-address-dialogs__notice']}>{content.noAddressNotice}</p>
    );

  return (
    <AddressBookDialog
      content={content}
      kinds={setup.kinds}
      closeLabel={closeLabel}
      addresses={addresses}
      current={current}
      notice={notice}
      onConfirm={(address) => {
        // Bekci "Hayır" derse (sepet korunur) pencere acik kalir: baska adres secilebilir.
        void choose(address.id).then((changed) => {
          if (changed) onClose();
        });
      }}
      onAdd={() => onOpen('add')}
      onClose={onClose}
    />
  );
}
