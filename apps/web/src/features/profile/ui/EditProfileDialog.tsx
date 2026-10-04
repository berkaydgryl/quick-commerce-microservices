import type { ProfileContent, UserProfile } from '@getir/contracts';
import { useState } from 'react';

import { useToastStore } from '../../../shared/toast/toast-store';
import { AddressDialog } from '../../address/ui/AddressDialog';
import { formatPhone, fromE164 } from '../../auth/services/phone';
import { formFeedback } from '../../auth/services/server-errors';
import { useSendEmailCode } from '../hooks/useSendEmailCode';
import { useSendPhoneCode, useVerifyPhone } from '../hooks/usePhoneVerification';
import { useVerifyEmail } from '../hooks/useVerifyEmail';
import { codeWindow } from '../services/code-window';
import type { CodeWindow } from '../services/code-window';
import { CODE_FORM_FIELDS } from '../services/email-forms';
import { PHONE_CODE_FIELDS, needsPassword, phoneFeedback } from '../services/phone-forms';

import { CodeForm } from './CodeForm';
import { EmailForm } from './EmailForm';
import { NameForm } from './NameForm';
import { PhoneForm } from './PhoneForm';
import { PhoneVerifyStart } from './PhoneVerifyStart';
import styles from './ProfileDialog.module.css';
import { ProfileOverviewView } from './ProfileOverviewView';

/** Pencerenin adimi (T11.14 PR 3). */
export type EditProfileStep =
  'overview' | 'email' | 'email-code' | 'phone-change' | 'phone-verify' | 'phone-code';

/** Son gonderilen kodlar: pencere kapanip acilsa da kod adimi surer. */
export interface CodeWindows {
  readonly email: CodeWindow | undefined;
  readonly phone: CodeWindow | undefined;
}

interface EditProfileDialogProps {
  readonly userId: string;
  readonly profile: UserProfile;
  readonly texts: ProfileContent;
  /** Acilis adimi: kalem genel gorunum, "E-posta ekle" e-posta, "Doğrula" telefon. */
  readonly initialStep: EditProfileStep;
  readonly windows: CodeWindows;
  readonly onWindows: (windows: CodeWindows) => void;
  readonly onClose: () => void;
}

/**
 * "Profili düzenle" penceresi (T11.14 PR 3; referansta tek kalem): genel
 * gorunumde ad yerinde duzenlenir; e-posta ve telefon satirlari kendi
 * adimlarini acar (e-posta: adres -> kod; telefon: yeni numara + sifre -> kod
 * ya da simdiki numarayi dogrulama -> kod). Alt adimlardan geri oku genel
 * gorunume doner; dogrulaninca bildirim cikar ve genel gorunume donulur.
 */
export function EditProfileDialog({
  userId,
  profile,
  texts,
  initialStep,
  windows,
  onWindows,
  onClose,
}: EditProfileDialogProps) {
  const show = useToastStore((state) => state.show);
  const [step, setStep] = useState<EditProfileStep>(initialStep);
  const verifyEmail = useVerifyEmail(userId);
  const resendEmail = useSendEmailCode();
  const verifyPhone = useVerifyPhone(userId);
  const resendPhone = useSendPhoneCode();
  const { editDialog, emailDialog, phoneDialog } = texts;

  const title =
    step === 'overview'
      ? editDialog.title
      : step.startsWith('email')
        ? emailDialog.title
        : phoneDialog.title;
  const back =
    step === 'overview'
      ? undefined
      : { label: editDialog.backLabel, onAction: () => setStep('overview') };
  const emailWindow = windows.email;
  const phoneWindow = windows.phone;

  return (
    <AddressDialog
      title={title}
      back={back}
      close={{ label: editDialog.closeLabel, onAction: onClose }}
    >
      {step === 'overview' && (
        <div className={styles['c-profile-dialog']}>
          <NameForm
            userId={userId}
            texts={editDialog}
            fullName={profile.fullName}
            onSaved={() => show(editDialog.nameSavedToast)}
          />
          <ProfileOverviewView
            profile={profile}
            texts={editDialog}
            onEmail={() =>
              setStep(
                emailWindow !== undefined && emailWindow.expiresAt > Date.now()
                  ? 'email-code'
                  : 'email',
              )
            }
            onChangePhone={() => setStep('phone-change')}
            onVerifyPhone={() => setStep('phone-verify')}
          />
        </div>
      )}
      {step === 'email' && (
        <EmailForm
          texts={emailDialog}
          initialEmail={emailWindow?.address ?? ''}
          onSent={(window) => {
            onWindows({ ...windows, email: window });
            setStep('email-code');
          }}
        />
      )}
      {step === 'email-code' && emailWindow !== undefined && (
        <CodeForm
          texts={emailDialog}
          changeLabel={emailDialog.changeEmailLabel}
          displayAddress={emailWindow.address}
          window={emailWindow}
          verify={async (code) => {
            await verifyEmail.mutateAsync({ email: emailWindow.address, code });
          }}
          resend={async () => {
            const sent = await resendEmail.mutateAsync({ email: emailWindow.address });
            onWindows({ ...windows, email: codeWindow(sent.email, sent, Date.now()) });
          }}
          feedback={(error) => {
            const result = formFeedback(error, CODE_FORM_FIELDS);
            return { code: result.fields.code, message: result.fields.email ?? result.message };
          }}
          onChangeAddress={() => setStep('email')}
          onVerified={() => {
            onWindows({ ...windows, email: undefined });
            show(emailDialog.verifiedToast);
            setStep('overview');
          }}
        />
      )}
      {step === 'phone-change' && (
        <PhoneForm
          texts={phoneDialog}
          initialDigits={
            phoneWindow !== undefined && phoneWindow.address !== profile.phone
              ? fromE164(phoneWindow.address)
              : ''
          }
          onSent={(window) => {
            onWindows({ ...windows, phone: window });
            setStep('phone-code');
          }}
        />
      )}
      {step === 'phone-verify' && (
        <PhoneVerifyStart
          texts={phoneDialog}
          phone={profile.phone}
          onSent={(window) => {
            onWindows({ ...windows, phone: window });
            setStep('phone-code');
          }}
        />
      )}
      {step === 'phone-code' && phoneWindow !== undefined && (
        <CodeForm
          texts={phoneDialog}
          changeLabel={phoneDialog.changePhoneLabel}
          displayAddress={formatPhone(phoneWindow.address)}
          window={phoneWindow}
          verify={async (code) => {
            await verifyPhone.mutateAsync({ phone: phoneWindow.address, code });
          }}
          resend={async () => {
            try {
              const sent = await resendPhone.mutateAsync({ phone: phoneWindow.address });
              onWindows({ ...windows, phone: codeWindow(sent.phone, sent, Date.now()) });
            } catch (error) {
              // Kodun omru doldu: yeni numaraya sifre yeniden sorulur.
              if (!needsPassword(error)) {
                throw error;
              }
              setStep('phone-change');
            }
          }}
          feedback={(error) => {
            const result = phoneFeedback(error, PHONE_CODE_FIELDS);
            return { code: result.fields.code, message: result.fields.phone ?? result.message };
          }}
          onChangeAddress={() => setStep('phone-change')}
          onVerified={() => {
            const changed = phoneWindow.address !== profile.phone;
            onWindows({ ...windows, phone: undefined });
            show(changed ? phoneDialog.changedToast : phoneDialog.verifiedToast);
            setStep('overview');
          }}
        />
      )}
    </AddressDialog>
  );
}
