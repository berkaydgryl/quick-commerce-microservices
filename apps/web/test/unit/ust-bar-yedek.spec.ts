/**
 * Ust bar icerik hatasinda bozulmaz (F21; 07.10 hatasi): icerik ucu hata
 * verirse ya da gateway ile web arasindaki surum farki yuzunden sema gecmezse
 * arama kutusu ve adres dugmesi icerik yedegiyle AYNEN cizilir; barda hata
 * mesaji ve "Tekrar dene" yok. Sade bar (sepet, odeme) da adres dugmesini
 * gosterir.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppHeaderAddress, AppHeaderSearch } from '../../src/app/AppHeader';
import { createQueryClient } from '../../src/app/query-client';
import { appHeaderTexts } from '../../src/features/content/hooks/useAppHeaderContent';
import { contentKeys } from '../../src/features/content/api/query-keys';

const HEADER = CONTENT_FALLBACK.appHeader;

/**
 * Icerik sorgusu hata durumunda (sema gecmedi ya da uc 500), uygulamanin
 * QueryClient'iyla (ayni yeniden deneme ayarlari). Takilinca yeniden deneme
 * (retryOnMount) sorguyu "yukleniyor"a dondurur ve hatayi siler: yedek yine
 * de kalmali (code-review: yer tutucuya dusup acik pencereyi kapatiyordu).
 */
async function failedContent(): Promise<QueryClient> {
  const client = createQueryClient();
  await client.prefetchQuery({
    queryKey: contentKeys.welcome(),
    queryFn: () => Promise.reject(new Error('Beklenmeyen bir sorun oldu. Birazdan tekrar dene.')),
  });
  expect(client.getQueryState(contentKeys.welcome())?.status).toBe('error');
  return client;
}

const render = (client: QueryClient, node: ReactNode) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(QueryClientProvider, { client }, node)),
  );

describe('ust bar icerik hatasinda (F21)', () => {
  it('arama kutusu yedekle cizilir; hata mesaji ve "Tekrar dene" yok', async () => {
    const html = render(await failedContent(), createElement(AppHeaderSearch));

    expect(html).toContain(`placeholder="${HEADER.searchPlaceholder}"`);
    expect(html).not.toContain('Beklenmeyen bir sorun oldu');
    expect(html).not.toContain('Tekrar dene');
    expect(html).not.toContain('role="alert"');
  });

  it('arama kutusunun yanindaki adres dugmesi de cizilir (Ev cipi kaybolmaz)', async () => {
    const html = render(await failedContent(), createElement(AppHeaderSearch));

    // Oturum belli olana kadar dugme yer tutucu; icerik hatasi onu SILMEZ.
    expect(html).toContain('c-header-search__address');
    expect(html).toContain('c-header-address__trigger');
  });

  it('sade barin adres dugmesi (sepet, odeme) bos kalmaz', async () => {
    const html = render(await failedContent(), createElement(AppHeaderAddress));

    expect(html).toContain('c-header-address__trigger');
  });

  it('icerik yuklenirken ayni boyda yer tutucu (bar ziplamaz)', () => {
    const html = render(new QueryClient(), createElement(AppHeaderSearch));

    expect(html).toMatch(/aria-busy="true"/);
  });

  it('bir kez hata olduysa yeniden istek surerken (hata null, yukleniyor) yedek KALIR', () => {
    expect(appHeaderTexts({ data: undefined, errorUpdatedAt: 0 })).toBeUndefined();
    expect(appHeaderTexts({ data: undefined, errorUpdatedAt: 1_700_000_000_000 })).toEqual({
      appHeader: CONTENT_FALLBACK.appHeader,
      addressSetup: CONTENT_FALLBACK.addressSetup,
      closeLabel: CONTENT_FALLBACK.closeLabel,
    });
  });
});
