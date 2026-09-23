/**
 * Ara toplam: satirlarin birim fiyat x adet toplami. Indirim ve teslimat
 * HARIC; tum esikler (minimum sepet, ucretsiz teslimat, kupon kosulu) bu
 * tutara bakar (B12).
 */

import { AppError } from '@getir/core';

import { assertMinor } from './money.js';
import type { CartLine } from './types.js';

export function calculateSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => {
    assertMinor(line.unitPriceMinor, 'unitPriceMinor');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw AppError.validation('Adet pozitif tam sayi olmali', {
        details: { field: 'quantity', productId: line.productId },
      });
    }
    return sum + line.unitPriceMinor * line.quantity;
  }, 0);
}
