/**
 * Katalogun gocleri (T10.4, ADR-19), surum sirasinda. Servis acilista
 * bekleyenleri uygular; elle: pnpm --filter @getir/catalog-service migrate
 * up | down | status.
 *
 * Yeni goc: `000N-kisa-ad.ts` dosyasi ve bu listenin SONUNA. Uygulanmis goc
 * degistirilmez; duzeltme yeni goctur.
 */

import type { Migration } from '@getir/mongo-kit';

import { foldSearchTerms } from './0001-arama-terimlerini-katla.js';

export const MIGRATIONS: readonly Migration[] = [foldSearchTerms];
