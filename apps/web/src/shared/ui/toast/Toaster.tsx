import { useEffect } from 'react';

import { TOAST_DURATION_MS } from '../../toast/toast-queue';
import type { Toast } from '../../toast/toast-queue';
import { useToastStore } from '../../toast/toast-store';
import { STROKE_PROPS } from '../icons/stroke-props';

import styles from './Toaster.module.css';

interface ToasterProps {
  /** Kapatma dugmesinin erisilebilir adi (icerikten). */
  readonly dismissLabel: string;
}

/**
 * Uygulamanin bildirim alani (T11.13): ekranin altinda, ortada. Ekran okuyucu
 * yeni bildirimi okur (aria-live polite: kullanicinin isini kesmez). Her
 * bildirim suresi dolunca kendiliginden kapanir; X ile hemen kapanir.
 */
export function Toaster({ dismissLabel }: ToasterProps) {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return <ToasterView toasts={toasts} dismissLabel={dismissLabel} onDismiss={dismiss} />;
}

interface ToasterViewProps {
  readonly toasts: readonly Toast[];
  readonly dismissLabel: string;
  readonly onDismiss: (id: number) => void;
}

/** Bildirim alaninin gorunumu (depodan bagimsiz: test edilir). */
export function ToasterView({ toasts, dismissLabel, onDismiss }: ToasterViewProps) {
  return (
    <div className={styles['c-toaster']} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} dismissLabel={dismissLabel} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  readonly toast: Toast;
  readonly dismissLabel: string;
  readonly onDismiss: (id: number) => void;
}

function ToastItem({ toast, dismissLabel, onDismiss }: ToastItemProps) {
  // Sure bildirim basinadir; bildirim erken kapanirsa sayac temizlenir.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={styles['c-toaster__toast']}>
      <p className={styles['c-toaster__message']}>{toast.message}</p>
      <button
        type="button"
        className={styles['c-toaster__dismiss']}
        aria-label={dismissLabel}
        onClick={() => onDismiss(toast.id)}
      >
        <svg {...STROKE_PROPS}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
