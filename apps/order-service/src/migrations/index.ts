/**
 * Servisin gocleri (T10.4, ADR-19), surum sirasinda. Henuz goc yok; servis
 * acilista yine de kayitlari okur: kodda olmayan uygulanmis surum (kod geri
 * alinmis) acilisi durdurur. Elle: pnpm --filter @getir/order-service migrate
 * up | down | status.
 *
 * Yeni goc: `0001-kisa-ad.ts` dosyasi ve bu listenin SONUNA. Uygulanmis goc
 * degistirilmez; duzeltme yeni goctur. Ornek: catalog-service/src/migrations.
 */

import type { Migration } from '@getir/mongo-kit';

export const MIGRATIONS: readonly Migration[] = [];
