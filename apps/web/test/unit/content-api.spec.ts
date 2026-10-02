import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { fetchWelcomeContent } from '../../src/features/content/api/content.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const ASSET = 'http://localhost:5173';

const welcome = {
  header: { brand: 'getir', service: 'market', loginLabel: 'Giriş yap', registerLabel: 'Kayıt ol' },
  hero: {
    title: 'Kapına gelen market: getirmarket',
    banner: {
      sources: [{ url: `${ASSET}/img/banner/kapina-gelen-market-960.jpg`, width: 960 }],
      width: 960,
      height: 277,
    },
  },
  loginCard: {
    title: 'Giriş yap veya kayıt ol',
    countryLabel: 'Ülke kodu',
    phoneLabel: 'Telefon numarası',
    phonePlaceholder: '5XX XXX XX XX',
    continueLabel: 'Devam Et',
    closeLabel: 'Kapat',
    showPasswordLabel: 'Şifreyi göster',
    countries: [
      { code: 'TR', name: 'Türkiye', dialCode: '+90', flagUrl: `${ASSET}/img/flag/tr.svg` },
    ],
    login: {
      passwordLabel: 'Şifren',
      submitLabel: 'Giriş yap',
      pendingLabel: 'Giriş yapılıyor…',
      registerPrompt: 'Hesabın yok mu?',
      registerLinkLabel: 'Kayıt ol',
    },
    register: {
      fullNameLabel: 'Adın soyadın',
      passwordLabel: 'Şifre belirle',
      submitLabel: 'Kayıt ol',
      pendingLabel: 'Kaydın yapılıyor…',
      loginPrompt: 'Zaten hesabın var mı?',
      loginLinkLabel: 'Giriş yap',
    },
  },
  categories: { title: 'Kategoriler' },
};

function clientReturning(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

describe('fetchWelcomeContent', () => {
  it('GET /v1/content/welcome cagirir ve icerigi sozlesmeyle dogrular', async () => {
    const { fetchMock, client } = clientReturning({ success: true, data: welcome });

    const content = await fetchWelcomeContent(client);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/content/welcome');
    expect(content).toEqual(welcome);
  });

  it('bos metin sozlesme ihlalidir: ekranda bos dugme olmaz, INTERNAL', async () => {
    const { client } = clientReturning({
      success: true,
      data: { ...welcome, header: { ...welcome.header, loginLabel: '' } },
    });

    await expect(fetchWelcomeContent(client)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});
