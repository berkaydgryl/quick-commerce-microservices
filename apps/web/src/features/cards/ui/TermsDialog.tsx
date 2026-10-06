import { Dialog } from '../../../shared/ui/dialog/Dialog';

import styles from './TermsDialog.module.css';

interface TermsDialogProps {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly closeLabel: string;
  readonly onClose: () => void;
}

/**
 * Kart saklama kosullari (T11.17): ortak pencere kabugunda kisa panel. Metin
 * icerikten (paymentMethods.termsParagraphs); ayri kosullar sayfasi yok.
 */
export function TermsDialog({ title, paragraphs, closeLabel, onClose }: TermsDialogProps) {
  return (
    <Dialog title={title} close={{ label: closeLabel, onAction: onClose }}>
      <div className={styles['c-terms-dialog']}>
        {/* Sabit liste, sirasi degismez: anahtar sira (ayni metinli iki paragraf cakismaz; QA D8). */}
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </Dialog>
  );
}
