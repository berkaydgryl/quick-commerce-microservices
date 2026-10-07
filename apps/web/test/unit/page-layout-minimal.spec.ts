/**
 * Sade ust bar (T16.3; sepet ve odeme sayfalari; referans getircarsi sepet
 * sayfasi): logo ve beyaz kutuda teslimat adresi, yaninda sayfanin cipi;
 * arama ve Profil YOK. Alt bilgi govdenin altinda. Tam bar degismez.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { HeaderSlotContext } from '../../src/shared/ui/page-layout/header-slot';
import { PageLayout } from '../../src/shared/ui/page-layout/PageLayout';

const SLOTS = { logo: 'LOGO', search: 'ARAMA', account: 'PROFIL', address: 'ADRES' };

function render(props: Parameters<typeof PageLayout>[0]): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(HeaderSlotContext.Provider, { value: SLOTS }, createElement(PageLayout, props)),
    ),
  );
}

describe('PageLayout sade bar (T16.3)', () => {
  it('logo, adres kutusu ve sayfanin cipi; arama ve Profil yok', () => {
    const markup = render({ variant: 'minimal', headerExtra: 'TVS', children: 'GOVDE' });
    const header = /<header[\s\S]*<\/header>/.exec(markup)?.[0] ?? '';

    expect(header).toContain('LOGO');
    expect(header).toMatch(/c-page-layout__chip[^"]*">ADRES</);
    expect(header).toContain('TVS');
    expect(header).not.toContain('ARAMA');
    expect(header).not.toContain('PROFIL');
  });

  it('alt bilgi govdenin (main) altinda; ekran yuksekliginde sutunun icinde (dipte durur)', () => {
    const markup = render({ variant: 'minimal', footer: 'ALT', children: 'GOVDE' });

    expect(markup).toMatch(
      /^<div class="[^"]*c-page-layout_[^"]*"><header[\s\S]*GOVDE[\s\S]*<\/main>ALT<\/div>$/,
    );
  });

  it('alt bilgisiz sayfa sarmalanmaz: diger sayfalarin DOM agaci ayni', () => {
    expect(render({ children: 'GOVDE' })).toMatch(/^<header/);
  });

  it('tam bar (varsayilan): arama ve Profil var, ayri adres kutusu yok', () => {
    const markup = render({ children: 'GOVDE' });

    expect(markup).toContain('ARAMA');
    expect(markup).toContain('PROFIL');
    expect(markup).not.toContain('ADRES');
  });
});
