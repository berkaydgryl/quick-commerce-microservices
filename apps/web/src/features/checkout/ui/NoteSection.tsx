import { CHECKOUT_TEXT_MAX } from '@getir/contracts';
import type { CheckoutContent } from '@getir/contracts';
import { useId } from 'react';

import { CheckboxField } from '../../../shared/ui/checkbox/CheckboxField';
import { SectionCard } from '../../../shared/ui/section-card/SectionCard';
import { TextAreaField } from '../../../shared/ui/text-area/TextAreaField';

import styles from './NoteSection.module.css';

interface NoteSectionProps {
  readonly note: string;
  readonly doNotRingBell: boolean;
  readonly texts: Pick<
    CheckoutContent,
    'noteTitle' | 'noteLabel' | 'notePlaceholder' | 'doNotRingLabel'
  >;
  readonly onNoteChange: (note: string) => void;
  readonly onDoNotRingBellChange: (doNotRingBell: boolean) => void;
}

/**
 * Not Ekle (T17.1; referans getircarsi #33): solda siparis notu (sayacli,
 * 250), dikey ayiricidan sonra sagda "Zili Çalma"; dar ekranda alt alta. Not
 * kisisel veri olabilir: yalnizca form durumunda.
 */
export function NoteSection({
  note,
  doNotRingBell,
  texts,
  onNoteChange,
  onDoNotRingBellChange,
}: NoteSectionProps) {
  const id = useId();
  return (
    <SectionCard title={texts.noteTitle}>
      <div className={styles['c-note']}>
        <TextAreaField
          id={`${id}-not`}
          label={texts.noteLabel}
          value={note}
          maxLength={CHECKOUT_TEXT_MAX}
          placeholder={texts.notePlaceholder}
          onChange={onNoteChange}
        />
        <div className={styles['c-note__options']}>
          <CheckboxField
            id={`${id}-zil`}
            label={texts.doNotRingLabel}
            checked={doNotRingBell}
            onChange={onDoNotRingBellChange}
          />
        </div>
      </div>
    </SectionCard>
  );
}
