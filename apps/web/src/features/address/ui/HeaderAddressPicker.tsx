import type { AddressSetupContent, AppHeaderContent } from '@getir/contracts';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { useAddressBook } from '../hooks/useAddressBook';
import { selectedAddress } from '../services/delivery-address';
import { deliveryLabel } from '../services/delivery-label';

import { AddressDialogs } from './AddressDialogs';
import type { AddressDialog } from './AddressDialogs';
import styles from './HeaderAddressPicker.module.css';
import { ChevronRightIcon, PinIcon } from './icons';
import { kindIcon } from './kind-icon';

interface HeaderAddressPickerProps {
  readonly content: AppHeaderContent;
  /** Adres ekleme penceresinin metinleri ve tur ikonlari (T11.8). */
  readonly setup: AddressSetupContent;
  /** Pencerelerin X'inin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  /** Giris ekraninin adresi (donus bu sayfa); uygulama verir: adres ozelligi kimlik yollarini tanimaz. */
  readonly loginHref: string;
}

type OpenDialog = 'none' | AddressDialog;

/**
 * Ust bar aramasinin sag ucundaki teslimat adresi (T11.10; referans
 * getircarsi "🏠 Ev ›"; teslimat suresi YOK). Hangi adresin gecerli oldugu
 * useAddressBook'tadir (T9.5).
 *
 *  - Oturum ve defter cozulene kadar yalnizca ikon.
 *  - Oturumsuz ziyaretci varsayilan "Ev"i gorur; dugme giris ekranina gider.
 *  - Oturumdaki kullanici: "Adreslerim" penceresi (radyo + "Adresi Onayla");
 *    alt banttaki "Adres Ekle" T11.8'in harita + detay penceresini acar.
 *    Orada X yalnizca kapatir (cikis degil); kaydedince yeni adres secilir.
 *
 * Secim sepete DOKUNMAZ: urunun yeni adreste satilip satilmadigina
 * rezervasyon karar verir (T11.4).
 */
export function HeaderAddressPicker({
  content,
  setup,
  closeLabel,
  loginHref,
}: HeaderAddressPickerProps) {
  // Defter BURADA, secici durdukca bagli kalan tek gozlemciyle okunur (T9.5
  // dersi: hata notu kendi gozlemcisini baglasaydi okunamayan sorgu dongude
  // yeniden baslardi).
  const book = useAddressBook();
  const { delivery, addresses } = book;
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const [open, setOpen] = useState<OpenDialog>('none');

  if (delivery.status === 'pending') {
    return (
      <span className={styles['c-header-address__trigger']} aria-busy="true">
        <span className={styles['c-header-address__icon']}>
          <PinIcon />
        </span>
      </span>
    );
  }

  const current = selectedAddress(addresses, delivery);
  // Gorunen ad: hesabin adresi kendi adiyla, varsayilan adres icerikteki "Ev" etiketiyle.
  const label = deliveryLabel(delivery, setup.kinds);
  // Varsayilan adres "Ev"dir; hesabin adresi kendi turunun ikonunu gosterir.
  const icon = kindIcon(setup.kinds, delivery.source === 'account' ? current?.kind : 'HOME');
  const face = (
    <>
      <span className={styles['c-header-address__icon']} aria-hidden="true">
        {icon ?? <PinIcon />}
      </span>
      <span className={styles['c-header-address__title']}>{label}</span>
      <span className={styles['c-header-address__chevron']}>
        <ChevronRightIcon />
      </span>
    </>
  );

  if (userId === null || (delivery.source === 'default' && delivery.reason === 'anonymous')) {
    return (
      <Link
        to={loginHref}
        className={styles['c-header-address__trigger']}
        aria-label={`${content.addressLabel}: ${label}. ${content.addressLoginLabel}`}
      >
        {face}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles['c-header-address__trigger']}
        aria-label={`${content.addressLabel}: ${label}`}
        aria-haspopup="dialog"
        onClick={() => setOpen('book')}
      >
        {face}
      </button>
      {open !== 'none' && (
        <AddressDialogs
          book={book}
          content={content}
          setup={setup}
          closeLabel={closeLabel}
          userId={userId}
          open={open}
          onOpen={setOpen}
          onClose={() => setOpen('none')}
        />
      )}
    </>
  );
}
