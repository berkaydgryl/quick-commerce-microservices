import type { AddressSetupContent, GeoPoint } from '@getir/contracts';
import { useState } from 'react';

import { useLineResolver } from '../hooks/useLineResolver';
import type { ResolvedLine } from '../services/line-notice';

import { AddressDetailsForm } from './AddressDetailsForm';
import { AddressDialog } from './AddressDialog';
import { AddressMapStep } from './AddressMapStep';
import styles from './AddressSetupDialog.module.css';

interface AddressSetupDialogProps {
  readonly content: AddressSetupContent;
  /** 1. adimdaki kapat (X) dugmesinin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly userId: string;
  /**
   * Kapatmak (X, Esc). Ilk adres penceresinde CIKIS (kullanici adres eklemeden
   * uygulamaya giremez); ust bardan acilan eklemede yalnizca pencere kapanir.
   */
  readonly onClose: () => void;
  /** Kapatma suruyor (cikis): X bekler. */
  readonly closing?: boolean;
  /** Kapatma basarisiz (cikis: ag, 503): oturum yerinde kalir, mesaj gorunur. */
  readonly closeError?: string | null;
  /** true: detay adiminda geri okunun yaninda X da olur (ust bardan ekleme, T11.10). */
  readonly closableOnDetails?: boolean;
  /** Kayittan sonra (ust bardan eklemede pencere kapanir; ilk adreste kapi gecer). */
  readonly onSaved?: () => void;
}

type Step =
  | { readonly name: 'map' }
  | { readonly name: 'details'; readonly location: GeoPoint; readonly resolved: ResolvedLine };

/**
 * Adres ekleme penceresi (T11.8): oturum acik ama kayitli adres yoksa
 * karsilama ekraninin ustunde acilir (RootPage). Iki adim:
 *
 *  1. Harita: nokta secilir (surukle ya da ara), "Bu adresi kullan" noktanin
 *     adres satirini sorar. Basliktaki X (ve Esc) CIKIS yapar.
 *  2. Detay: satir dolu gelir, bina/kat/daire ve tarif yazilir, "Kaydet".
 *     Baslikta geri oku vardir (Esc de geri): 1. adima doner, secilen nokta
 *     korunur. Ilk adres penceresinde X yoktur (kullanicinin karari); ust
 *     bardan acilan eklemede X de vardir (T11.10, referans).
 *
 * Ayni pencere ust bardaki "Adreslerim"den de acilir (T11.10): orada X
 * yalnizca kapatir ve kaydedince pencere kapanir.
 */
export function AddressSetupDialog({
  content,
  closeLabel,
  userId,
  onClose,
  closing = false,
  closeError = null,
  closableOnDetails = false,
  onSaved,
}: AddressSetupDialogProps) {
  const [step, setStep] = useState<Step>({ name: 'map' });
  const [center, setCenter] = useState<GeoPoint>(content.map.center);
  const [chosen, setChosen] = useState(false);
  const resolver = useLineResolver(content.unresolvedNotice);

  const choose = (point: GeoPoint): void => {
    setCenter(point);
    setChosen(true);
  };
  const useAddress = (): void => {
    const location = center;
    resolver.mutate(location, {
      onSuccess: (resolved) => setStep({ name: 'details', location, resolved }),
    });
  };

  const close = { label: closeLabel, onAction: onClose, disabled: closing };
  const onDetails = step.name === 'details';

  return (
    <AddressDialog
      title={content.title}
      back={
        onDetails
          ? { label: content.backLabel, onAction: () => setStep({ name: 'map' }) }
          : undefined
      }
      close={onDetails && !closableOnDetails ? undefined : close}
    >
      {step.name === 'map' ? (
        <>
          {closeError !== null && (
            <p className={styles['c-address-setup__alert']} role="alert">
              {closeError}
            </p>
          )}
          <AddressMapStep
            content={content}
            center={center}
            chosen={chosen}
            resolving={resolver.isPending}
            onMove={choose}
            onPick={(place) => choose(place.location)}
            onUse={useAddress}
          />
        </>
      ) : (
        <AddressDetailsForm
          content={content}
          userId={userId}
          location={step.location}
          resolved={step.resolved}
          onSaved={onSaved}
        />
      )}
    </AddressDialog>
  );
}
