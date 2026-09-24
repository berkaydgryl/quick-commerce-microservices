/**
 * geofence: teslimat adresi ile oturum konumu arasi 50 km'den fazla (farkli
 * sehir). Iki konumdan biri yoksa tetiklenmez. Gerekce konumu DEGIL yalnizca
 * mesafeyi yazar: koordinat kisisel veridir, risk_events'e girmez.
 */

import { GEOFENCE_MAX_DISTANCE_KM } from '../config/constants.js';
import { distanceKm } from '../domain/geo.js';
import type { Rule } from '../domain/rule.js';

export const geofenceRule: Rule = {
  id: 'geofence',
  evaluate: ({ deliveryLocation, sessionLocation }) => {
    if (deliveryLocation === undefined || sessionLocation === undefined) {
      return Promise.resolve({ hit: false, reason: 'konum bilinmiyor' });
    }
    // Karsilastirma HAM mesafeyle: once yuvarlamak esigi 50.5 km'ye kaydirirdi.
    const distance = distanceKm(deliveryLocation, sessionLocation);
    const km = Math.round(distance);
    return Promise.resolve(
      distance > GEOFENCE_MAX_DISTANCE_KM
        ? { hit: true, reason: `oturum teslimat adresinden ${km} km uzakta` }
        : { hit: false, reason: `oturum teslimat adresinden ${km} km uzakta` },
    );
  },
};
