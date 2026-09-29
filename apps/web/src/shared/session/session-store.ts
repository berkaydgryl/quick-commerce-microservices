/**
 * Oturum deposu (T8.5; istemci durumu -> Zustand).
 *
 * Erisim jetonu YALNIZCA bellekte durur: localStorage'a, sessionStorage'a ya da
 * cereze yazilmaz; sayfaya sizan bir betik (XSS) kalici bir jeton bulamaz.
 * Yenileme jetonu HttpOnly cerezdedir, betik onu hic gormez (ADR-12 eki).
 *
 * Sayfa yenilenince bellek bosalir; oturum acilistaki sessiz yenilemeyle geri
 * gelir (restore-session.ts). Cevap gelene kadar durum "unknown": korumali
 * sayfa ve basliktaki hesap alani bekler, herkese acik sayfa beklemez.
 */

import type { AuthSession, UserProfile } from '@getir/contracts';
import { create } from 'zustand';

export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

/**
 * Alanlar HER geciste birlikte yazilir: Zustand set() birlestirir; yalnizca
 * durum yazilsaydi cikistan sonra eski jeton bellekte kalirdi.
 */
export interface SessionState {
  readonly status: SessionStatus;
  readonly accessToken: string | null;
  readonly user: UserProfile | null;
}

export interface SessionActions {
  /** Giris, kayit ya da yenileme cevabi: oturum bu sekmede acik. */
  readonly signIn: (session: AuthSession) => void;
  /** Bu sekmede oturum yok: cikis, gecersiz cerez ya da acilista geri yuklenemedi. */
  readonly signOut: () => void;
}

export type SessionStore = SessionState & SessionActions;

export const UNKNOWN_SESSION: SessionState = { status: 'unknown', accessToken: null, user: null };
export const ANONYMOUS_SESSION: SessionState = {
  status: 'anonymous',
  accessToken: null,
  user: null,
};

export function authenticatedSession(session: AuthSession): SessionState {
  return { status: 'authenticated', accessToken: session.accessToken, user: session.user };
}

export function createSessionStore() {
  return create<SessionStore>()((set) => ({
    ...UNKNOWN_SESSION,
    signIn: (session) => set(authenticatedSession(session)),
    signOut: () => set(ANONYMOUS_SESSION),
  }));
}

/** Uygulamanin oturumu: sekme basina bir tane, bellekte. */
export const useSessionStore = createSessionStore();
