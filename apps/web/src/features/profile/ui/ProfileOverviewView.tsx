import type { EditProfileDialogContent, UserProfile } from '@getir/contracts';

import { formatPhone } from '../../auth/services/phone';

import styles from './ProfileDialog.module.css';

export interface ProfileOverviewViewProps {
  readonly profile: UserProfile;
  readonly texts: EditProfileDialogContent;
  readonly onEmail: () => void;
  readonly onChangePhone: () => void;
  readonly onVerifyPhone: () => void;
}

/**
 * "Profili düzenle" penceresinin satirlari (T11.14 PR 3): e-posta (yoksa
 * "Ekle", varsa "Değiştir") ve telefon ("Değiştir"; dogrulanmamissa ayrica
 * "Doğrula"). Ad formu ustte ayri (NameForm). Durumsuz.
 */
export function ProfileOverviewView({
  profile,
  texts,
  onEmail,
  onChangePhone,
  onVerifyPhone,
}: ProfileOverviewViewProps) {
  return (
    <dl className={styles['c-profile-dialog__rows']}>
      <div className={styles['c-profile-dialog__row']}>
        <dt className={styles['c-profile-dialog__term']}>{texts.emailLabel}</dt>
        <dd className={styles['c-profile-dialog__value']}>
          {profile.email ?? texts.emptyEmailLabel}
        </dd>
        <dd className={styles['c-profile-dialog__actions']}>
          <button type="button" className={styles['c-profile-dialog__link']} onClick={onEmail}>
            {profile.email === undefined ? texts.addLabel : texts.changeLabel}
          </button>
        </dd>
      </div>
      <div className={styles['c-profile-dialog__row']}>
        <dt className={styles['c-profile-dialog__term']}>{texts.phoneLabel}</dt>
        <dd className={styles['c-profile-dialog__value']}>{formatPhone(profile.phone)}</dd>
        <dd className={styles['c-profile-dialog__actions']}>
          {profile.phoneVerified !== true && (
            <button
              type="button"
              className={styles['c-profile-dialog__link']}
              onClick={onVerifyPhone}
            >
              {texts.verifyLabel}
            </button>
          )}
          <button
            type="button"
            className={styles['c-profile-dialog__link']}
            onClick={onChangePhone}
          >
            {texts.changeLabel}
          </button>
        </dd>
      </div>
    </dl>
  );
}
