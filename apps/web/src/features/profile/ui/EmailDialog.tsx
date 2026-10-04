import type { EmailDialogContent } from '@getir/contracts';
import { useState } from 'react';

import { useToastStore } from '../../../shared/toast/toast-store';
import { AddressDialog } from '../../address/ui/AddressDialog';
import type { CodeWindow } from '../services/code-window';

import { CodeForm } from './CodeForm';
import { EmailForm } from './EmailForm';

interface EmailDialogProps {
  readonly userId: string;
  readonly texts: EmailDialogContent;
  /** Son gonderilen kod: pencere kapanip acilsa da kod adimi surer. */
  readonly window: CodeWindow | undefined;
  readonly onWindow: (window: CodeWindow | undefined) => void;
  readonly onClose: () => void;
}

/**
 * E-posta penceresi (T11.14): once adres, sonra kod. Pencere adres
 * penceresinin kendisidir (karartmaya tiklamak kapatmaz: kod yazarken kaza ile
 * kapanmasin; Esc ve X kapatir). Gecerli bir kod varken yeniden acilan pencere
 * dogrudan kod adimindadir. Dogrulaninca bildirim cikar ve pencere kapanir;
 * kart yeni adresi profil onbelleginden gosterir.
 */
export function EmailDialog({ userId, texts, window, onWindow, onClose }: EmailDialogProps) {
  const show = useToastStore((state) => state.show);
  const [step, setStep] = useState<'email' | 'code'>(() =>
    window !== undefined && window.expiresAt > Date.now() ? 'code' : 'email',
  );
  const [draft, setDraft] = useState(window?.email ?? '');

  return (
    <AddressDialog title={texts.title} close={{ label: texts.closeLabel, onAction: onClose }}>
      {step === 'code' && window !== undefined ? (
        <CodeForm
          userId={userId}
          texts={texts}
          window={window}
          onResent={onWindow}
          onChangeEmail={() => setStep('email')}
          onVerified={() => {
            onWindow(undefined);
            show(texts.verifiedToast);
            onClose();
          }}
        />
      ) : (
        <EmailForm
          texts={texts}
          initialEmail={draft}
          onSent={(sent) => {
            onWindow(sent);
            setDraft(sent.email);
            setStep('code');
          }}
        />
      )}
    </AddressDialog>
  );
}
