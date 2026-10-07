import { useEffect, useRef } from 'react';

import styles from './ConfirmPanel.module.css';

export interface ConfirmPanelProps {
  /** Sorunun kimligi: pencere adini buradan alir (aria-labelledby). */
  readonly questionId?: string | undefined;
  /** Tek soru (F13; silinen seye gore): "Kartı silmek istediğinden emin misin?". */
  readonly question: string;
  /**
   * Yalniz ekran okuyucunun duydugu ayrinti, sorunun arkasina: hangi kart ya da
   * adres ("Visa, son dört hane 4242"; QA K4). Gorunen soru duz kalir (PM S1 (a)).
   */
  readonly spokenDetail?: string | undefined;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  /** Islem suruyor: dugmeler bekler. */
  readonly pending: boolean;
  readonly yesLabel: string;
  readonly noLabel: string;
  /** "Evet" beklerken ("Siliniyor…"); yoksa "Evet" kalir. */
  readonly pendingLabel?: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Ortak onay govdesi (F13; 07.10 kullanici istegi, referans #57; T11.15'te adres
 * silme icin yazildi, T11.17'de ortaklasti): ortada tek soru, altta yan yana iki
 * esit dugme, solda beyaz zeminli mor cerceveli "Hayır", sagda dolu mor "Evet".
 * Acilinca odak "Hayır"da (yanlislikla silmeye karsi). Hata pencerede kalir.
 * Kabugu ConfirmDialog verir. Durumsuz (odak disinda).
 */
export function ConfirmPanel({
  questionId,
  question,
  spokenDetail,
  error,
  pending,
  yesLabel,
  noLabel,
  pendingLabel,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  const no = useRef<HTMLButtonElement>(null);
  // Pencere acildiktan sonra (Dialog showModal'i yerlesim etkisinde cagirir).
  useEffect(() => {
    no.current?.focus();
  }, []);

  return (
    <div className={styles['c-confirm-panel']}>
      <p id={questionId} className={styles['c-confirm-panel__question']}>
        {question}
        {spokenDetail !== undefined && (
          <span className={styles['c-confirm-panel__spoken']}> {spokenDetail}</span>
        )}
      </p>
      {error !== null && (
        <p className={styles['c-confirm-panel__alert']} role="alert">
          {error}
        </p>
      )}
      <div className={styles['c-confirm-panel__actions']}>
        <button
          ref={no}
          type="button"
          className={styles['c-confirm-panel__no']}
          disabled={pending}
          onClick={onCancel}
        >
          {noLabel}
        </button>
        <button
          type="button"
          className={styles['c-confirm-panel__yes']}
          disabled={pending}
          aria-busy={pending}
          onClick={onConfirm}
        >
          {pending && pendingLabel !== undefined ? pendingLabel : yesLabel}
        </button>
      </div>
    </div>
  );
}
