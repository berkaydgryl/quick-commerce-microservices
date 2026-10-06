import type { AddressKind, AddressSetupContent, GeoPoint, SavedAddress } from '@getir/contracts';
import { useState } from 'react';

import { useLineResolver } from '../hooks/useLineResolver';
import { isSamePoint } from '../services/geo-point';
import { resolvedLine } from '../services/line-notice';
import type { ResolvedLine } from '../services/line-notice';

import { AddressDetailsForm } from './AddressDetailsForm';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
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
  /** Eklemede secili tur (Adreslerim'in "Ev / İş / Diğer adres ekle"si, T11.15). */
  readonly initialKind?: AddressKind;
  /**
   * Duzenleme modu (T11.15, T7): harita adresin noktasinda acilir, detay
   * kayitli degerlerle dolu gelir, kayit PUT'tur. Baslik `editing.title`.
   */
  readonly editing?: {
    readonly address: SavedAddress;
    readonly title: string;
    /** Detay adimindaki "Adresi sil" (T1: secili adres buradan silinir). */
    readonly deleteLabel: string;
    readonly onDelete: () => void;
  };
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
 *
 * Adreslerim sekmesi (T11.15) ayni pencereyi duzenleme modunda acar: nokta
 * adresin konumunda secili gelir; nokta degismediyse "Bu adresi kullan"
 * adresin kendi satirini korur (yeniden sorgu yok), degistiyse satir yeni
 * noktadan cozulur.
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
  initialKind,
  editing,
}: AddressSetupDialogProps) {
  const [step, setStep] = useState<Step>({ name: 'map' });
  const [center, setCenter] = useState<GeoPoint>(editing?.address.location ?? content.map.center);
  const [chosen, setChosen] = useState(editing !== undefined);
  const resolver = useLineResolver(content.unresolvedNotice);

  const choose = (point: GeoPoint): void => {
    setCenter(point);
    setChosen(true);
  };
  const useAddress = (): void => {
    const location = center;
    const kept = editing?.address;
    if (kept !== undefined && isSamePoint(kept.location, location)) {
      setStep({ name: 'details', location, resolved: resolvedLine(kept.line) });
      return;
    }
    resolver.mutate(location, {
      onSuccess: (resolved) => setStep({ name: 'details', location, resolved }),
    });
  };

  const close = { label: closeLabel, onAction: onClose, disabled: closing };
  const onDetails = step.name === 'details';

  return (
    <Dialog
      title={editing?.title ?? content.title}
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
          initialKind={initialKind}
          editing={editing}
        />
      )}
    </Dialog>
  );
}
