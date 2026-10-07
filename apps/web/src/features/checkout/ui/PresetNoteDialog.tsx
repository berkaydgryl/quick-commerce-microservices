import { Dialog } from '../../../shared/ui/dialog/Dialog';

import styles from './PresetNoteDialog.module.css';

interface PresetNoteDialogProps {
  readonly title: string;
  readonly closeLabel: string;
  readonly notes: readonly string[];
  readonly onPick: (note: string) => void;
  readonly onClose: () => void;
}

/**
 * Hazir notlar (T17.1; referans getircarsi "Hazır Not Ekle"): ortak pencerede
 * not listesi; secilen not "Hediye Kartı Notu" alanina yazilir, pencere kapanir.
 * Notlar icerikten (checkout.presetNotes).
 */
export function PresetNoteDialog({
  title,
  closeLabel,
  notes,
  onPick,
  onClose,
}: PresetNoteDialogProps) {
  return (
    <Dialog title={title} close={{ label: closeLabel, onAction: onClose }}>
      <ul className={styles['c-preset-notes']} role="list">
        {/* Sabit liste, sirasi degismez: anahtar sira (ayni metinli iki not cakismaz). */}
        {notes.map((note, index) => (
          <li key={index}>
            <button
              type="button"
              className={styles['c-preset-notes__note']}
              onClick={() => onPick(note)}
            >
              {note}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
