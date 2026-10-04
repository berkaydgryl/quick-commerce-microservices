import type { ProfileContent, UserProfile } from '@getir/contracts';
import { NavLink } from 'react-router-dom';

import { formatPhone } from '../../auth/services/phone';

import { MailIcon, PencilIcon, PhoneIcon, VerifiedIcon } from './icons';
import styles from './ProfileCard.module.css';

export interface ProfileCardViewProps {
  /** GET /v1/me; yuklenirken undefined. */
  readonly profile: UserProfile | undefined;
  readonly texts: ProfileContent;
  /** Adin gittigi Hesabim sayfasi. */
  readonly accountHref: string;
  /** Kalem ve "E-posta ekle": e-posta penceresini acar. */
  readonly onEditEmail: () => void;
}

/**
 * Profil karti (T11.14; referans getircarsi; kullanicinin karari: ad, altinda
 * telefon, onun altinda e-posta). Sag ustte kalem e-posta penceresini acar
 * (ad degisikligi bekleyen is #89). Dogrulanmis e-postanin yaninda yesil onay;
 * telefonun yaninda YOK: numara dogrulanmaz (ADR-12), onay yaniltirdi.
 * E-postasi olmayan kartta e-posta satiri "E-posta ekle" der. Durumsuz:
 * pencere ve sorgu ProfileCard'da.
 */
export function ProfileCardView({
  profile,
  texts,
  accountHref,
  onEditEmail,
}: ProfileCardViewProps) {
  return (
    <section className={styles['c-profile-card']} aria-busy={profile === undefined}>
      <button
        type="button"
        className={styles['c-profile-card__edit']}
        aria-label={texts.editEmailLabel}
        aria-haspopup="dialog"
        disabled={profile === undefined}
        onClick={onEditEmail}
      >
        <PencilIcon />
      </button>
      {profile === undefined ? (
        <p className={styles['c-profile-card__loading']} role="status">
          {texts.loadingLabel}
        </p>
      ) : (
        <>
          <NavLink to={accountHref} end className={() => styles['c-profile-card__name']}>
            {profile.fullName}
          </NavLink>
          <dl className={styles['c-profile-card__details']}>
            <div className={styles['c-profile-card__row']}>
              <dt className={styles['c-profile-card__term']}>
                <span
                  className={styles['c-profile-card__icon']}
                  role="img"
                  aria-label={texts.phoneLabel}
                >
                  <PhoneIcon />
                </span>
              </dt>
              <dd className={styles['c-profile-card__value']}>{formatPhone(profile.phone)}</dd>
            </div>
            <div className={styles['c-profile-card__row']}>
              <dt className={styles['c-profile-card__term']}>
                <span
                  className={styles['c-profile-card__icon']}
                  role="img"
                  aria-label={texts.emailLabel}
                >
                  <MailIcon />
                </span>
              </dt>
              <dd className={styles['c-profile-card__value']}>
                {profile.email === undefined ? (
                  <button
                    type="button"
                    className={styles['c-profile-card__add']}
                    aria-haspopup="dialog"
                    onClick={onEditEmail}
                  >
                    {texts.addEmailLabel}
                  </button>
                ) : (
                  <>
                    <span className={styles['c-profile-card__email']}>{profile.email}</span>
                    <span
                      className={styles['c-profile-card__verified']}
                      role="img"
                      aria-label={texts.verifiedLabel}
                    >
                      <VerifiedIcon />
                    </span>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
