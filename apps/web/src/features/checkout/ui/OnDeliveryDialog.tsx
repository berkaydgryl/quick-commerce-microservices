import type { CheckoutContent, DeliveryPaymentKind } from '@getir/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useStepFocus } from '../hooks/useStepFocus';
import type { PaymentChoice } from '../services/payment-choice';

import styles from './OnDeliveryDialog.module.css';
import { OnDeliveryOptions } from './OnDeliveryOptions';

interface OnDeliveryDialogProps {
  /** Sayfada uygulanan kapida odeme turu: pencere onu secili acar. */
  readonly applied: DeliveryPaymentKind | undefined;
  /** Bu siparis icin kapida odeme reddedildi (422): sunucunun cumlesi; secenekler pasif. */
  readonly refusedNotice?: string | undefined;
  readonly texts: CheckoutContent;
  readonly onChoose: (choice: PaymentChoice) => void;
  readonly onClose: () => void;
}

/**
 * Kart kasasi KAPALI pakette (production; __CARD_VAULT__ false) "Ödeme Yöntemi
 * Seç" penceresi (F12): yalniz "Kapıda Ödeme" secenekleri ve "Seç". Kart
 * uclari ve kart bilesenleri bu pakete girmez (paket taramasi).
 */
export function OnDeliveryDialog({
  applied,
  refusedNotice,
  texts,
  onChoose,
  onClose,
}: OnDeliveryDialogProps) {
  const name = useId();
  const [pending, setPending] = useState(refusedNotice === undefined ? applied : undefined);
  // Odak isaretli radyoda (P4; kartli pencereyle ayni), yoksa ilk etkin secenekte.
  const root = useStepFocus<HTMLDivElement>(
    'input[type="radio"]:checked',
    'input[type="radio"]:not(:disabled), button:not(:disabled)',
  );
  return (
    <Dialog title={texts.methodDialogTitle} close={{ label: texts.closeLabel, onAction: onClose }}>
      <div ref={root} className={styles['c-on-delivery-dialog']}>
        <OnDeliveryOptions
          name={name}
          selected={pending}
          refusedNotice={refusedNotice}
          texts={texts}
          onPick={setPending}
        />
        <button
          type="button"
          className={styles['c-on-delivery-dialog__choose']}
          disabled={pending === undefined}
          onClick={() => {
            if (pending !== undefined) {
              onChoose({ kind: 'onDelivery', onDelivery: pending });
            }
          }}
        >
          {texts.chooseLabel}
        </button>
      </div>
    </Dialog>
  );
}
