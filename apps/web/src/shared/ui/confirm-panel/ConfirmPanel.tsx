import styles from './ConfirmPanel.module.css';

export interface ConfirmPanelProps {
  /** Sorunun konusu, kalin: "Ev", "Visa •••• 4242". Yoksa soru tek basina (sepeti bosaltma, T16.3). */
  readonly subject?: string;
  /** Konunun okunan hali (or. "Visa, son dört hane 4242"); verilirse gorunen konu ekran okuyucudan gizlenir. */
  readonly spokenSubject?: string;
  /** Konunun arkasindaki soru ("adresini silmek istiyor musun?"); konu yoksa sorunun tamami. */
  readonly questionSuffix: string;
  /** Sorunun altindaki not: "Geçmiş siparişlerin bundan etkilenmez.". */
  readonly hint: string;
  /** Sunucunun cumlesi (ag, 404); yoksa null. */
  readonly error: string | null;
  /** Islem suruyor: dugmeler bekler. */
  readonly pending: boolean;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Geri alinamaz islemin onay govdesi (T11.15'te adres silme icin yazildi,
 * T11.17'de ortaklasti, M6): soru, not, hata ve iki dugme ("Vazgeç", kirmizi
 * "Sil"). Pencere kabugunu (baslik, X, Esc) cagiran ozellik verir. Durumsuz.
 */
export function ConfirmPanel({
  subject,
  spokenSubject,
  questionSuffix,
  hint,
  error,
  pending,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  return (
    <div className={styles['c-confirm-panel']}>
      <p className={styles['c-confirm-panel__question']}>
        {subject !== undefined && (
          <>
            <strong className={styles['c-confirm-panel__subject']}>
              {spokenSubject === undefined ? (
                subject
              ) : (
                <>
                  <span aria-hidden="true">{subject}</span>
                  <span className={styles['c-confirm-panel__spoken']}>{spokenSubject}</span>
                </>
              )}
            </strong>{' '}
          </>
        )}
        {questionSuffix}
      </p>
      <p className={styles['c-confirm-panel__hint']}>{hint}</p>
      {error !== null && (
        <p className={styles['c-confirm-panel__alert']} role="alert">
          {error}
        </p>
      )}
      <div className={styles['c-confirm-panel__actions']}>
        <button
          type="button"
          className={styles['c-confirm-panel__cancel']}
          disabled={pending}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={styles['c-confirm-panel__confirm']}
          disabled={pending}
          aria-busy={pending}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
