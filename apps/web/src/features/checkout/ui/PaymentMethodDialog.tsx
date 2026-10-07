import type { CheckoutContent, PaymentMethodsContent, SavedCard } from '@getir/contracts';
import { useReducer, useState } from 'react';
import type { ReactNode } from 'react';

import { formFeedback } from '../../auth/services/server-errors';
import { useAddCard } from '../../cards/hooks/useAddCard';
import { useDeleteCard } from '../../cards/hooks/useDeleteCard';
import { useSavedCards } from '../../cards/hooks/useSavedCards';
import { cardShortName, cardSpokenName } from '../../cards/services/card-face';
import { AddCardForm } from '../../cards/ui/AddCardForm';
import { ConfirmPanel } from '../../../shared/ui/confirm-panel/ConfirmPanel';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useStepFocus } from '../hooks/useStepFocus';
import { methodDialogReducer, openMethodDialog } from '../services/method-dialog';
import type { MethodDialogStart, MethodStep } from '../services/method-dialog';
import { effectiveCard } from '../services/selected-card';

import styles from './PaymentMethodDialog.module.css';
import { PaymentMethodList } from './PaymentMethodList';

interface PaymentMethodDialogProps {
  readonly userId: string;
  /** Sayfada uygulanan kart: pencere onu secili acar. */
  readonly appliedId: string | undefined;
  readonly start: MethodDialogStart;
  readonly texts: CheckoutContent;
  readonly cardTexts: PaymentMethodsContent;
  /** "Seç": bekleyen secim sayfaya yazilir. */
  readonly onChoose: (cardId: string) => void;
  readonly onClose: () => void;
}

function stepTitle(step: MethodStep, texts: CheckoutContent, cardTexts: PaymentMethodsContent) {
  switch (step.kind) {
    case 'list':
      return texts.methodDialogTitle;
    case 'add':
      return cardTexts.addTitle;
    case 'delete':
      return cardTexts.confirmTitle;
  }
}

/**
 * Adimin kabi: acilinca ilk eslesen ogeye odak (P4). Ekleme adiminda ilk alan
 * ("Karta İsim Ver"), onay adiminda "Vazgeç" (ConfirmPanel'de ilk dugme).
 */
function FocusedStep({
  selector,
  children,
}: {
  readonly selector: string;
  readonly children: ReactNode;
}) {
  const root = useStepFocus<HTMLDivElement>(selector, 'button');
  return (
    <div ref={root} className={styles['c-method-dialog__step']}>
      {children}
    </div>
  );
}

/**
 * "Ödeme Yöntemi Seç" penceresi (T17.1; F5; P1-P4): tek pencere, uc adim.
 * Liste -> "+ Kredi/Banka Kartı" ayni pencerede kart ekleme (AddCardForm
 * variant="checkout"; Ödeme Yöntemlerim'e gidilmez), "Kartı Sil" silme onayi.
 * Ekleme ve onay adiminda sol ustte geri oku; Esc once geri gider, listede
 * kapatir (ortak Dialog). Kartlar Ödeme Yöntemlerim'le AYNI sorgudan
 * (cardKeys.list): ekleme ve silme onu gunceller, iki sayfa ayni listeyi gorur.
 *
 * Numara ve CVV yalnizca ekleme adiminin form durumunda (M7): adim kapaninca
 * (geri, Esc, X, basari) form kalkar, yeniden acilinca alanlar bos. Hatalar
 * (kart zaten kayitli, kasa dolu, saglayici reddi, ag) adimin icinde gorunur;
 * pencere kapanmaz.
 */
export function PaymentMethodDialog({
  userId,
  appliedId,
  start,
  texts,
  cardTexts,
  onChoose,
  onClose,
}: PaymentMethodDialogProps) {
  const [state, dispatch] = useReducer(methodDialogReducer, undefined, () =>
    openMethodDialog(appliedId, start),
  );
  const cards = useSavedCards(userId).data ?? [];
  const { save, changed } = useAddCard(userId);
  const removing = useDeleteCard(userId);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { step } = state;
  const busy = removing.isPending;

  const back = (): void => {
    setDeleteError(null);
    dispatch({ type: 'back' });
  };

  const remove = async (card: SavedCard): Promise<void> => {
    setDeleteError(null);
    try {
      await removing.mutateAsync(card.id);
      dispatch({ type: 'deleted', cardId: card.id });
    } catch (error) {
      setDeleteError(formFeedback(error, []).message);
    }
  };

  return (
    <Dialog
      title={stepTitle(step, texts, cardTexts)}
      back={
        step.kind === 'list'
          ? undefined
          : { label: texts.backLabel, onAction: back, disabled: busy }
      }
      close={{ label: texts.closeLabel, onAction: onClose, disabled: busy }}
    >
      {step.kind === 'list' && (
        <PaymentMethodList
          cards={cards}
          selectedId={effectiveCard(cards, state.pendingId)?.id}
          focus={state.focus}
          texts={texts}
          cardTexts={cardTexts}
          onPick={(cardId) => dispatch({ type: 'pick', cardId })}
          onDelete={(card) => dispatch({ type: 'openDelete', card })}
          onAdd={() => dispatch({ type: 'openAdd' })}
          onChoose={onChoose}
        />
      )}
      {step.kind === 'add' && (
        <FocusedStep key={state.addSession} selector="input">
          <AddCardForm
            texts={cardTexts}
            variant="checkout"
            onSave={save}
            onChanged={changed}
            onSaved={(card) => dispatch({ type: 'added', card, session: state.addSession })}
          />
        </FocusedStep>
      )}
      {step.kind === 'delete' && (
        <FocusedStep selector="button">
          <ConfirmPanel
            subject={cardShortName(step.card, cardTexts.brandLabels)}
            spokenSubject={cardSpokenName(
              step.card,
              cardTexts.brandLabels,
              cardTexts.lastFourLabel,
            )}
            questionSuffix={cardTexts.confirmQuestionSuffix}
            hint={cardTexts.confirmHint}
            error={deleteError}
            pending={busy}
            confirmLabel={cardTexts.confirmLabel}
            pendingLabel={cardTexts.deletingLabel}
            cancelLabel={cardTexts.cancelLabel}
            onConfirm={() => void remove(step.card)}
            onCancel={back}
          />
        </FocusedStep>
      )}
    </Dialog>
  );
}
