import type { CheckoutContent } from '@getir/contracts';
import { useId, useState } from 'react';

import { TermsDialog } from '../../cards/ui/TermsDialog';

import styles from './AgreementField.module.css';

type AgreementTexts = Pick<
  CheckoutContent,
  | 'preInfoLinkLabel'
  | 'agreementJoiner'
  | 'distanceSalesLinkLabel'
  | 'agreementSuffix'
  | 'preInfoParagraphs'
  | 'distanceSalesParagraphs'
  | 'closeLabel'
>;

interface AgreementFieldProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly texts: AgreementTexts;
}

/**
 * Sozlesme onayi (T17.1; referans getircarsi): "Ön Bilgilendirme Formu ve
 * Mesafeli Satış Sözleşmesi'ni okudum, kabul ediyorum." Iki ad dugmedir:
 * metni kisa pencerede acar (kart kosullarinin penceresi, TermsDialog).
 * Kutunun erisilebilir adi tek parca cumle. Metinler bugun DEMO (M6).
 */
export function AgreementField({ checked, onChange, texts }: AgreementFieldProps) {
  const id = useId();
  const [open, setOpen] = useState<'none' | 'preInfo' | 'distanceSales'>('none');
  const sentence = `${texts.preInfoLinkLabel} ${texts.agreementJoiner} ${texts.distanceSalesLinkLabel}${texts.agreementSuffix}`;

  return (
    <div className={styles['c-agreement']}>
      <input
        id={id}
        type="checkbox"
        className={styles['c-agreement__box']}
        checked={checked}
        aria-label={sentence}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles['c-agreement__text']}>
        <button
          type="button"
          className={styles['c-agreement__link']}
          onClick={() => setOpen('preInfo')}
        >
          {texts.preInfoLinkLabel}
        </button>{' '}
        {texts.agreementJoiner}{' '}
        <button
          type="button"
          className={styles['c-agreement__link']}
          onClick={() => setOpen('distanceSales')}
        >
          {texts.distanceSalesLinkLabel}
        </button>
        <label htmlFor={id}>{texts.agreementSuffix}</label>
      </span>
      {open !== 'none' && (
        <TermsDialog
          title={open === 'preInfo' ? texts.preInfoLinkLabel : texts.distanceSalesLinkLabel}
          paragraphs={open === 'preInfo' ? texts.preInfoParagraphs : texts.distanceSalesParagraphs}
          closeLabel={texts.closeLabel}
          onClose={() => setOpen('none')}
        />
      )}
    </div>
  );
}
