import { describe, expect, it } from 'vitest';

import type { DarkStore } from '../../src/domain/catalog.js';
import type { StoreDistance } from '../../src/domain/dark-store-resolution.js';
import { resolveDarkStore } from '../../src/domain/dark-store-resolution.js';

function store(id: string, radius: number, isOpen = true): DarkStore {
  return { id, name: id, lat: 0, lng: 0, deliveryRadiusMeters: radius, isOpen };
}

function at(target: DarkStore, distance: number): StoreDistance {
  return { store: target, distanceMeters: distance };
}

describe('resolveDarkStore', () => {
  it('yaricap icindeki en yakin acik depoyu secer', () => {
    const result = resolveDarkStore([at(store('a', 2000), 500), at(store('b', 2000), 900)]);

    expect(result).toEqual({ kind: 'served', store: store('a', 2000), distanceMeters: 500 });
  });

  it('yaricap SINIRI dahildir (mesafe == yaricap)', () => {
    expect(resolveDarkStore([at(store('a', 2000), 2000)]).kind).toBe('served');
  });

  it('en yakin depo kapaliysa kapsayan diger ACIK depoya duser', () => {
    // Kullanici kapsayan bir depo aciksa hizmet alir; kapali olan yakinlik
    // yuzunden onu engellememeli.
    const result = resolveDarkStore([at(store('a', 2000, false), 300), at(store('b', 3000), 1200)]);

    expect(result).toMatchObject({ kind: 'served', store: { id: 'b' } });
  });

  it('kapsayan depolarin hepsi kapaliysa "closed"; mesafe en yakina gore', () => {
    const result = resolveDarkStore([at(store('a', 2000, false), 300), at(store('b', 500), 4000)]);

    expect(result).toEqual({ kind: 'closed', nearestDistanceMeters: 300 });
  });

  it('hicbir deponun yaricapinda degilse "out-of-range" + en yakin mesafe', () => {
    // Yaricap bir ACIK depoya ait olsa da mesafe onu gecer.
    const result = resolveDarkStore([at(store('a', 2000), 8400), at(store('b', 2000), 9100)]);

    expect(result).toEqual({ kind: 'out-of-range', nearestDistanceMeters: 8400 });
  });

  it('hic depo yoksa "no-stores"', () => {
    expect(resolveDarkStore([])).toEqual({ kind: 'no-stores' });
  });
});
