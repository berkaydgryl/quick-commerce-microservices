import type { ProfileContent, UserProfile } from '@getir/contracts';
import { NavLink } from 'react-router-dom';

import { formatPhone } from '../../auth/services/phone';

import { EditIcon, MailIcon, PhoneIcon, VerifiedIcon } from './icons';
import styles from './ProfileCard.module.css';

export interface ProfileCardViewProps {
  /** GET /v1/me; yuklenirken undefined. */
  readonly profile: UserProfile | undefined;
  readonly texts: ProfileContent;
  /**
   * Adin gittigi Hesabim sayfasi. Alt sekmelerde verilir (kart menunun
   * ustunde); Hesabim'in kendisinde verilmez: ad duz metindir.
   */
  readonly accountHref?: string | undefined;
  /** Kalem ve "E-posta ekle": e-posta penceresini acar. */
  readonly onEditEmail: () => void;
}

/**
 * Profil karti (T11.14; PR 2'de referansa gore: getircarsi profil sayfasi,
 * 18.16). Ad, altinda e-posta, onun altinda telefon; kalem kartin ust
 * kenarina tasar. Dogrulanmis e-postanin yaninda yesil onay; telefonda onay
 * YOK: numara dogrulanmaz (ADR-12). Onay, numara kodla dogrulaninca gelir
 * (phoneVerifiedAt, PR 3). E-postasiz kartta e-posta satiri "E-posta ekle"
 * der. Durumsuz: pencere ve sorgu ProfileCard'da.
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
        <EditIcon />
      </button>
      {profile === undefined ? (
        <p className={styles['c-profile-card__loading']} role="status">
          {texts.loadingLabel}
        </p>
      ) : (
        <>
          <p className={styles['c-profile-card__name']}>
            {accountHref === undefined ? (
              profile.fullName
            ) : (
              <NavLink to={accountHref} end className={() => styles['c-profile-card__link']}>
                {profile.fullName}
              </NavLink>
            )}
          </p>
          <dl className={styles['c-profile-card__details']}>
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
                    <span className={styles['c-profile-card__text']}>{profile.email}</span>
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
              <dd className={styles['c-profile-card__value']}>
                <span className={styles['c-profile-card__text']}>{formatPhone(profile.phone)}</span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
