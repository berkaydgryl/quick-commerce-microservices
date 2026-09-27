/**
 * Bir gRPC cagrisinin use-case'e tasinan baglami.
 *
 * requestId, order'in baska servisi cagirirken x-request-id olarak AYNEN
 * iletmesi icindir (yeniden uretilmez; bir istek, butun servislerde tek iz).
 * logger handler'in ctx.logger'idir: rpc ve requestId bagli (D2).
 */

import type { Logger } from '@getir/core';

export interface RequestScope {
  readonly requestId: string;
  readonly logger: Logger;
}
