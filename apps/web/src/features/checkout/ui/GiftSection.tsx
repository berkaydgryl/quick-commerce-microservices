import type { CheckoutContent } from '@getir/contracts';
import { useId, useState } from 'react';

import { SectionCard } from '../../../shared/ui/section-card/SectionCard';
import { Switch } from '../../../shared/ui/switch/Switch';
import { TextAreaField } from '../../../shared/ui/text-area/TextAreaField';
import { PHONE_COUNTRY_PREFIX } from '../../auth/services/phone';
import { AuthField } from '../../auth/ui/AuthField';
import { PhoneField } from '../../auth/ui/PhoneField';
import { CHECKOUT_TEXT_MAX, GIFT_NAME_MAX } from '../services/checkout-rules';
import type { GiftFieldErrors, GiftForm } from '../services/checkout-rules';

import styles from './GiftSection.module.css';
import { PresetNoteDialog } from './PresetNoteDialog';

interface GiftSectionProps {
  readonly gift: GiftForm;
  /** Gorunen hatalar (alan terk edildikten sonra; sayfa karar verir). */
  readonly errors: GiftFieldErrors;
  readonly texts: CheckoutContent;
  readonly onChange: (patch: Partial<GiftForm>) => void;
  readonly onBlur: (field: keyof GiftFieldErrors) => void;
}

/**
 * Hediye Bilgileri (T17.1; referans getircarsi #33): Evet/Hayır anahtari
 * kartin ICINDE sag ustte (kapaliyken kart yalnizca anahtari tasir). Acikken
 * sirasiyla: "Hazır Not Ekle" (anahtarla ayni satirda), "Hediye Kartı Notu"
 * (sayacli), tek satirda gonderici adi, zorunlu alici adi ve telefonu (dar
 * ekranda alt alta), en altta bilgi ikonu ve notu. Alanlar kisisel veridir:
 * yalnizca form durumunda yasar (useCheckoutForm).
 */
export function GiftSection({ gift, errors, texts, onChange, onBlur }: GiftSectionProps) {
  const id = useId();
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = `${id}-bilgi`;

  return (
    <SectionCard title={texts.giftTitle}>
      <div className={styles['c-gift__top']}>
        {gift.enabled && (
          <button
            type="button"
            className={styles['c-gift__preset']}
            onClick={() => setPresetsOpen(true)}
          >
            {texts.presetNoteLabel}
          </button>
        )}
        <span className={styles['c-gift__switch']}>
          <Switch
            label={texts.giftToggleLabel}
            checked={gift.enabled}
            onChange={(enabled) => onChange({ enabled })}
            onText={texts.giftYesLabel}
            offText={texts.giftNoLabel}
          />
        </span>
      </div>
      {gift.enabled && (
        <>
          <TextAreaField
            id={`${id}-not`}
            label={texts.giftMessageLabel}
            value={gift.message}
            maxLength={CHECKOUT_TEXT_MAX}
            onChange={(message) => onChange({ message })}
          />
          <div className={styles['c-gift__fields']}>
            <AuthField
              id={`${id}-gonderen`}
              label={texts.senderNameLabel}
              value={gift.senderName}
              maxLength={GIFT_NAME_MAX}
              autoComplete="name"
              floatingLabel
              onChange={(event) => onChange({ senderName: event.target.value })}
            />
            <AuthField
              id={`${id}-alici`}
              label={`*${texts.recipientNameLabel}`}
              value={gift.recipientName}
              maxLength={GIFT_NAME_MAX}
              autoComplete="off"
              required
              floatingLabel
              error={errors.recipientName}
              onChange={(event) => onChange({ recipientName: event.target.value })}
              onBlur={() => onBlur('recipientName')}
            />
            <PhoneField
              id={`${id}-telefon`}
              label={`*${texts.recipientPhoneLabel}`}
              prefix={PHONE_COUNTRY_PREFIX}
              value={gift.recipientPhone}
              autoComplete="off"
              required
              error={errors.recipientPhone}
              onChange={(recipientPhone) => onChange({ recipientPhone })}
              onBlur={() => onBlur('recipientPhone')}
            />
          </div>
          <div className={styles['c-gift__info-row']}>
            <button
              type="button"
              className={styles['c-gift__info']}
              aria-label={texts.giftInfoLabel}
              aria-expanded={infoOpen}
              aria-controls={infoId}
              onClick={() => setInfoOpen((open) => !open)}
            >
              <span className={styles['c-gift__info-dot']} aria-hidden="true">
                i
              </span>
            </button>
            <p id={infoId} className={styles['c-gift__info-text']} hidden={!infoOpen}>
              {texts.giftInfoText}
            </p>
          </div>
        </>
      )}
      {presetsOpen && (
        <PresetNoteDialog
          title={texts.presetNotesTitle}
          closeLabel={texts.closeLabel}
          notes={texts.presetNotes}
          onPick={(message) => {
            onChange({ message: message.slice(0, CHECKOUT_TEXT_MAX) });
            setPresetsOpen(false);
          }}
          onClose={() => setPresetsOpen(false)}
        />
      )}
    </SectionCard>
  );
}
