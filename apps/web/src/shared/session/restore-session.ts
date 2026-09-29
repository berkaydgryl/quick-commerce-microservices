import type { SessionRefresher } from './session-refresher';
import type { SessionActions } from './session-store';

export interface RestoreSessionDeps {
  readonly refresher: SessionRefresher;
  readonly session: Pick<SessionActions, 'signOut'>;
}

/**
 * Acilista bir kez (T8.5): cerezdeki yenileme jetonuyla oturumu sessizce geri
 * getirir. Cerez yoksa ya da gecersizse durum "anonymous" olur (refresher).
 *
 * Gecici hatada (ag, 503, 429) da "anonymous": oturum SIMDI geri yuklenemedi,
 * sekme oturumsuz acilir. Cerez yerinde kalir (gateway yalnizca gecersiz jetonun
 * cerezini siler); bir sonraki acilis oturumu geri getirir.
 */
export async function restoreSession({ refresher, session }: RestoreSessionDeps): Promise<void> {
  try {
    await refresher.refresh();
  } catch {
    session.signOut();
  }
}
