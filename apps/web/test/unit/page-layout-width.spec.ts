/**
 * Oturumlu sayfalarin genisligi (T11.12): ana sayfa, /markets, market sayfasi
 * ve /hesabim PageLayout'u kullanir; bar ve govde karsilama ekraniyla AYNI
 * genis kapsayicidadir (90rem ve ustunde 80rem). Daha once dar kapsayicidaydi
 * (64rem): karsilamadan girince logo ve Profil iceri kayiyordu. Piksel
 * hizasi tarayicida canli olculur; burada kapsayici sinifi denetlenir.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WelcomeHeader } from '../../src/pages/welcome/WelcomeHeader';
import styles from '../../src/shared/ui/page-container/PageContainer.module.css';
import { PageLayout } from '../../src/shared/ui/page-layout/PageLayout';

const WIDE = `${styles['c-page-container']} ${styles['c-page-container--wide']}`;

const WELCOME_HEADER = {
  brand: 'getir',
  service: 'market',
  loginLabel: 'Giriş yap',
  registerLabel: 'Kayıt ol',
};

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

/** Etiketin (header, main) ilk cocugu, yani kapsayicinin sinifi. */
function containerClass(markup: string, tag: 'header' | 'main'): string | undefined {
  return new RegExp(`<${tag}[^>]*><div class="([^"]+)"`).exec(markup)?.[1];
}

describe('PageLayout genisligi (T11.12)', () => {
  const layout = render(createElement(PageLayout, null, 'icerik'));

  it('ust bar ve govde genis kapsayicida', () => {
    expect(containerClass(layout, 'header')).toBe(WIDE);
    expect(containerClass(layout, 'main')).toBe(WIDE);
  });

  it('oturumlu bar karsilama bariyla ayni kapsayiciyi kullanir', () => {
    const welcome = render(createElement(WelcomeHeader, { header: WELCOME_HEADER }));

    expect(containerClass(layout, 'header')).toBe(containerClass(welcome, 'header'));
  });
});
