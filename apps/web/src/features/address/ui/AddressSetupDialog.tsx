import type { AddressSetupContent, GeoPoint } from '@getir/contracts';
import { useState } from 'react';

import { useLineResolver } from '../hooks/useLineResolver';
import type { ResolvedLine } from '../services/line-notice';

import { AddressDetailsForm } from './AddressDetailsForm';
import { AddressDialog } from './AddressDialog';
import type { AddressDialogAction } from './AddressDialog';
import { AddressMapStep } from './AddressMapStep';
import styles from './AddressSetupDialog.module.css';

interface AddressSetupDialogProps {
  readonly content: AddressSetupContent;
  /** 1. adimdaki kapat (X) dugmesinin erisilebilir adi (icerikten). */
  readonly closeLabel: string;
  readonly userId: string;
  /** Kapatmak (X, Esc) = cikis: kullanici adres eklemeden uygulamaya giremez. */
  readonly onClose: () => void;
  /** Cikis suruyor: X bekler. */
  readonly closing: boolean;
  /** Cikis basarisiz (ag, 503): oturum yerinde kalir, mesaj gorunur. */
  readonly closeError: string | null;
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
 *     Baslikta X yerine geri oku vardir (Esc de geri): 1. adima doner, secilen
 *     nokta korunur.
 */
export function AddressSetupDialog({
  content,
  closeLabel,
  userId,
  onClose,
  closing,
  closeError,
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

  const action: AddressDialogAction =
    step.name === 'map'
      ? { kind: 'close', label: closeLabel, onAction: onClose, disabled: closing }
      : { kind: 'back', label: content.backLabel, onAction: () => setStep({ name: 'map' }) };

  return (
    <AddressDialog title={content.title} action={action}>
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
        />
      )}
    </AddressDialog>
  );
}
