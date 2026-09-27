/**
 * Git kurallari betigi (D13): commit basligi, dal adi ve kural dosyasindan okunan alanlar.
 */

import { describe, expect, it } from 'vitest';

import {
  branchNameProblem,
  commitSubjectProblem,
  loadAreas,
  parseAreas,
  rangeProblems,
} from '../git-conventions.mjs';

const areas = loadAreas();

describe('alan listesi kural dosyasindan (tek kaynak)', () => {
  it('proje-kurallari.mdc "Alan etiketleri" satirini okur', () => {
    expect(areas).toEqual([
      'contract',
      'platform',
      'gateway',
      'catalog',
      'inventory',
      'order',
      'payment',
      'risk',
      'courier',
      'realtime',
      'web',
    ]);
  });

  it('satir yoksa sessizce bos liste degil, hata verir', () => {
    expect(() => parseAreas('# kurallar\n- baska bir satir')).toThrow(/Alan etiketleri/);
  });
});

describe('commit basligi', () => {
  it.each([
    'feat(order): sunucu tarafi fiyat dogrulamasi ve catalog istemcisi (T7.2)',
    "refactor(platform): Redis anahtarlari tek kaynakta, idempotency sinirlari core'da (D1)",
    'docs(platform): denetim duzeltmelerinin sirasi (D1)',
    'test(web): sepet kabugu testleri (T16.2)',
  ])('uygun: %s', (subject) => {
    expect(commitSubjectProblem(subject, areas)).toBeNull();
  });

  it.each([
    ['Update schemas.spec.ts', /biciminde degil/],
    ['Update roadmap.md', /biciminde degil/],
    ['wip(order): yarim is (T7.2)', /bilinmeyen tip "wip"/],
    ['feat(orders): cogul alan (T7.2)', /izinli olmayan alan "orders"/],
    ['feat(repo): kok dosyalari (T1.1)', /izinli olmayan alan "repo"/],
    ['feat(order): gorev kimligi yok', /gorev kimligi yok/],
    ['feat(order): eksik kimlik (T7)', /gorev kimligi yok/],
    ['feat(order): bosluksuz kimlik(T7.2)', /gorev kimligi yok/],
    ['Feat(order): buyuk harfli tip (T7.2)', /biciminde degil/],
  ])('reddedilir: %s', (subject, reason) => {
    expect(commitSubjectProblem(subject, areas)).toMatch(reason);
  });
});

describe('dal adi', () => {
  it.each([
    'feat/order-fiyat-dogrulama',
    'refactor/order-test-bolme',
    'fix/platform-log-baglami',
    'feat/platform-commit-kontrolu',
    'fix/web-sepet-ve-stil',
  ])('uygun: %s', (branch) => {
    expect(branchNameProblem(branch, areas)).toBeNull();
  });

  it.each([
    ['feature/order-x', /bilinmeyen tip "feature"/],
    ['feat/orders-x', /izinli olmayan alan "orders"/],
    ['feat/order', /biciminde degil/],
    ['feat/order-Fiyat', /biciminde degil/],
    ['main', /biciminde degil/],
  ])('reddedilir: %s', (branch, reason) => {
    expect(branchNameProblem(branch, areas)).toMatch(reason);
  });
});

describe('commit araligi', () => {
  it('yalnizca kurala uymayanlari sha ve sebebiyle doner', () => {
    const log = () =>
      [
        '80d051e\tfeat(order): sunucu tarafi fiyat dogrulamasi ve catalog istemcisi (T7.2)',
        '62b6010\tUpdate schemas.spec.ts',
        '',
      ].join('\n');

    expect(rangeProblems('taban', 'uc', areas, log)).toEqual([
      {
        sha: '62b6010',
        subject: 'Update schemas.spec.ts',
        problem: expect.stringMatching(/biciminde degil/),
      },
    ]);
  });

  it('bos aralik: sorun yok', () => {
    expect(rangeProblems('taban', 'uc', areas, () => '')).toEqual([]);
  });
});
