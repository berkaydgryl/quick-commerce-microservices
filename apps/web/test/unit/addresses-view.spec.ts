/**
 * Adreslerim gorunumu (T11.15): satirlar, secili adreste yesil onay,
 * digerlerinde cop kutusu (T1), her satirda kalem (T2), satirin radyo ile
 * secimi (T3), "Ev / İş / Diğer adres ekle" (T4), bos, yukleniyor ve hata.
 * Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { AddressKindOption, SavedAddress } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AddressesView } from '../../src/pages/account/AddressesView';
import type { AddressesViewProps } from '../../src/pages/account/AddressesView';

const TEXTS = CONTENT_FALLBACK.addresses;
const KINDS: readonly AddressKindOption[] = [
  { kind: 'HOME', label: 'Ev', icon: '🏠' },
  { kind: 'WORK', label: 'İş', icon: '🏢' },
  { kind: 'OTHER', label: 'Diğer', icon: '📍' },
];

const EV: SavedAddress = {
  id: 'adr_00000000000000000000000000000001',
  title: 'Ev',
  kind: 'HOME',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
};
const IS: SavedAddress = {
  id: 'adr_00000000000000000000000000000002',
  title: 'İş',
  kind: 'WORK',
  line: 'Sinanpaşa Mah. Barbaros Blv. No:40, Beşiktaş',
  location: { lat: 41.0431, lng: 29.0071 },
};
const ESKI: SavedAddress = {
  id: 'adr_00000000000000000000000000000003',
  title: 'Yazlık',
  line: 'Ağva Mah. Sahil Yolu No:3, Şile',
  location: { lat: 41.1363, lng: 29.8539 },
};

const noop = () => undefined;
const view = (props: Partial<AddressesViewProps>) =>
  renderToStaticMarkup(
    createElement(AddressesView, {
      texts: TEXTS,
      kinds: KINDS,
      addresses: [EV, IS],
      error: null,
      onRetry: noop,
      selectedId: EV.id,
      actionsDisabled: false,
      onSelect: noop,
      onEdit: noop,
      onDelete: noop,
      onAdd: noop,
      ...props,
    }),
  );

/** Satirlarin HTML'i, sirayla. */
const rows = (html: string) => html.split('<li').slice(1);

describe('AddressesView (T11.15)', () => {
  it('baslik ve satirlar: tur ikonu, ad, adres satiri; kayit sirasinda', () => {
    const html = view({});

    expect(html).toContain(`<h1`);
    expect(html).toContain(TEXTS.title);
    const [ev, is] = rows(html);
    expect(ev).toContain('🏠');
    expect(ev).toContain(EV.title);
    expect(ev).toContain(EV.line);
    expect(is).toContain('🏢');
    expect(is).toContain(IS.title);
  });

  it('secili adreste yesil onay, cop kutusu YOK; digerinde cop kutusu (T1)', () => {
    const [ev, is] = rows(view({}));

    expect(ev).toContain(`aria-label="${TEXTS.selectedLabel}"`);
    expect(ev).not.toContain(`${EV.title} ${TEXTS.deleteSuffix}`);
    expect(is).toContain(`aria-label="${IS.title} ${TEXTS.deleteSuffix}"`);
    expect(is).not.toContain(TEXTS.selectedLabel);
  });

  it('her satirda kalem (T2); erisilebilir ad adresin adiyla', () => {
    const [ev, is] = rows(view({}));

    expect(ev).toContain(`aria-label="${EV.title} ${TEXTS.editSuffix}"`);
    expect(is).toContain(`aria-label="${IS.title} ${TEXTS.editSuffix}"`);
  });

  it('satirlar radyo grubudur (T3): secili satirin radyosu isaretli, ad grubu basliktan', () => {
    const html = view({});

    expect(html).toContain('role="radiogroup"');
    const [ev, is] = rows(html);
    expect(ev).toMatch(/type="radio"[^>]*checked=""/);
    expect(is).not.toMatch(/checked=""/);
  });

  it('turu olmayan eski kayit genel konum ikonuyla (Ev ikonu yaniltirdi)', () => {
    const [eski] = rows(view({ addresses: [ESKI], selectedId: ESKI.id }));

    expect(eski).not.toContain('🏠');
    expect(eski).toContain('<svg');
  });

  it('ekleme satirlari icerikteki sirayla (T4)', () => {
    const html = view({});
    const labels = TEXTS.addOptions.map((option) => option.label);

    const positions = labels.map((label) => html.indexOf(label));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('adresi olmayan hesap: bos notu ve ekleme satirlari; radyo grubu yok', () => {
    const html = view({ addresses: [], selectedId: undefined });

    expect(html).toContain(TEXTS.emptyNotice);
    expect(html).not.toContain('radiogroup');
    expect(html).toContain(TEXTS.addOptions[0]!.label);
  });

  it('varsayilan adres (secim yok): hicbir satir secili degil, hepsinde cop kutusu', () => {
    const html = view({ selectedId: undefined });

    expect(html).not.toContain(TEXTS.selectedLabel);
    expect(rows(html).filter((row) => row.includes(TEXTS.deleteSuffix))).toHaveLength(2);
  });

  it('defter yuklenirken yukleniyor notu; hata gelince tekrar dene', () => {
    expect(view({ addresses: undefined })).toContain(TEXTS.loadingLabel);
    const failed = view({ addresses: undefined, error: new Error('ag') });
    expect(failed).not.toContain(TEXTS.loadingLabel);
    expect(failed).toContain('<button');
  });

  it('pencere metinleri yuklenmediyse eylemler bekler (pasif), secim calisir', () => {
    const html = view({ actionsDisabled: true });
    const disabledButtons = html.match(/<button[^>]*disabled=""/g) ?? [];

    // 2 satirda kalem + 1 cop kutusu + 3 ekleme satiri.
    expect(disabledButtons).toHaveLength(6);
    expect(html).not.toMatch(/type="radio"[^>]*disabled/);
  });
});
