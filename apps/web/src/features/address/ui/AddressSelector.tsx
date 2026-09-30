import type { SavedAddress } from '@getir/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { QueryError, QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { useAddressBook } from '../hooks/useAddressBook';
import { selectedAddressIndex } from '../services/delivery-address';
import type { DefaultReason } from '../services/delivery-address';

import styles from './AddressSelector.module.css';
import { CheckIcon, ChevronDownIcon, PinIcon } from './icons';

interface AddressSelectorProps {
  /**
   * Giris ekraninin adresi (donus bu sayfa). Sayfa verir: adres ozelligi kimlik
   * ozelliginin yonlendirme kuralini tanimaz.
   */
  readonly loginHref: string;
}

/**
 * Teslimat adresi secici (T9.5) - TASARIMSIZ KABUK; ana sayfada aramanin
 * USTUNDE. Hangi adresin gecerli oldugu useAddressBook'tadir; bilesen
 * gosterir ve secimi iletir.
 *
 *  - Oturum ve adres defteri cozulene kadar yalnizca satirin basi.
 *  - Oturumdaki kullanicinin adresi varsa "Ev" dugmesi: liste hemen altinda
 *    acilir (icerigi asagi iter); secim ya da Esc kapatir.
 *  - Yoksa varsayilan "Ev" ve nedeni: giris baglantisi, "kayitli adresin yok"
 *    ya da okunamadi (+ tekrar dene).
 *
 * Kurye notu seciciye GELMEZ. Secim sepete DOKUNMAZ: urunun yeni adreste
 * satilip satilmadigina rezervasyon karar verir (T11.4).
 */
export function AddressSelector({ loginHref }: AddressSelectorProps) {
  // Defter BURADA, secici durdukca bagli kalan tek gozlemciyle okunur; alt
  // parcalar yalnizca prop alir. Hata notu kendi gozlemcisini baglasaydi
  // TanStack okunamayan sorguyu yeniden baslatirdi (retryOnMount): not kalkar,
  // hata gelince yine baglanir - bitmeyen dongu (canli testte bulundu).
  const { delivery, addresses, error, retry, choose } = useAddressBook();

  if (delivery.status === 'pending') {
    return (
      <div className={styles['c-address-selector']}>
        <p className={styles['c-address-selector__bar']}>
          <BarLead />
        </p>
      </div>
    );
  }
  if (delivery.source === 'default') {
    return (
      <div className={styles['c-address-selector']}>
        <p className={styles['c-address-selector__bar']}>
          <BarLead />
          <span className={styles['c-address-selector__title']}>{delivery.title}</span>
          <span className={styles['c-address-selector__hint']}>(varsayılan)</span>
        </p>
        <DefaultReasonNote
          reason={delivery.reason}
          loginHref={loginHref}
          error={error}
          onRetry={retry}
        />
      </div>
    );
  }
  return <AddressPicker addresses={addresses} current={delivery.title} onChoose={choose} />;
}

/** Satirin sabit basi: konum ikonu ve "Teslimat adresi". */
function BarLead() {
  return (
    <>
      <span className={styles['c-address-selector__icon']}>
        <PinIcon />
      </span>
      <span className={styles['c-address-selector__label']}>Teslimat adresi</span>
    </>
  );
}

interface DefaultReasonNoteProps {
  readonly reason: DefaultReason;
  readonly loginHref: string;
  /** Defterin hatasi; yalnizca "okunamadi"da gosterilir. Yeniden denerken null. */
  readonly error: Error | null;
  readonly onRetry: () => void;
}

/** Varsayilan adresin nedeni: kullanici neden secemedigini ve ne yapabilecegini gorur. */
function DefaultReasonNote({ reason, loginHref, error, onRetry }: DefaultReasonNoteProps) {
  switch (reason) {
    case 'anonymous':
      return (
        <p className={styles['c-address-selector__note']}>
          <Link to={loginHref} className={styles['c-address-selector__login']}>
            Adres seçmek için giriş yap
          </Link>
        </p>
      );
    case 'no-addresses':
      return <p className={styles['c-address-selector__note']}>Kayıtlı adresin yok.</p>;
    case 'unavailable':
      // Sunucunun mesaji; "Tekrar dene" yalnizca gecici hatada (QueryError).
      // Yeniden denerken hata yoktur: konum varsayilanda kalir, not bekler.
      return (
        <div className={styles['c-address-selector__note']}>
          {error === null ? (
            <QueryLoading>Adreslerin yükleniyor…</QueryLoading>
          ) : (
            <QueryError error={error} onRetry={onRetry} />
          )}
        </div>
      );
  }
}

interface AddressPickerProps {
  readonly addresses: readonly SavedAddress[];
  /** Gecerli adresin adi. */
  readonly current: string;
  readonly onChoose: (title: string) => void;
}

/**
 * Oturumdaki kullanicinin adresleri: "Ev" dugmesi ve hemen altinda acilan
 * liste (ad + adres satiri). Liste kapaliyken de DOM'dadir (aria-controls'un
 * hedefi). Secim ya da Esc listeyi kapatir ve odagi dugmeye geri verir: gizlenen
 * listedeki odak kaybolmaz. Secili adres yalnizca renkle degil isaretle de
 * belli olur (aria-pressed + ikon).
 */
function AddressPicker({ addresses, current, onChoose }: AddressPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selectedIndex = selectedAddressIndex(addresses, current);

  // Esc liste acikken belgenin her yerinde kapatir: fareyle acan kullanicinin
  // odagi dugmede olmayabilir (Safari dugmeye tiklayinca odak vermez). Odak
  // yalnizca secicideyse ya da hicbir yerde degilse dugmeye doner; arama
  // kutusundaki Esc'in odagi calinmaz.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      const active = document.activeElement;
      const focusWasHere =
        active === null || active === document.body || rootRef.current?.contains(active) === true;
      setOpen(false);
      if (focusWasHere) {
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const choose = (title: string): void => {
    onChoose(title);
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={styles['c-address-selector']}>
      <button
        ref={toggleRef}
        type="button"
        className={`${styles['c-address-selector__bar']} ${styles['c-address-selector__toggle']}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <BarLead />
        <span className={styles['c-address-selector__title']}>{current}</span>
        <span className={styles['c-address-selector__chevron']}>
          <ChevronDownIcon />
        </span>
      </button>
      <ul
        id={listId}
        className={styles['c-address-selector__list']}
        role="list"
        aria-label="Kayıtlı adreslerin"
        hidden={!open}
      >
        {addresses.map((address, index) => (
          // Sozlesmede adres kimligi yok; ad tekrarlanabilir, sira eklenir.
          <li key={`${index}-${address.title}`}>
            <button
              type="button"
              className={styles['c-address-selector__option']}
              aria-pressed={index === selectedIndex}
              onClick={() => choose(address.title)}
            >
              <span className={styles['c-address-selector__option-text']}>
                <span className={styles['c-address-selector__option-title']}>{address.title}</span>
                <span className={styles['c-address-selector__option-line']}>{address.line}</span>
              </span>
              {index === selectedIndex && (
                <span className={styles['c-address-selector__check']}>
                  <CheckIcon />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
