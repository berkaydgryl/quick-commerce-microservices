// logger.spec.ts'in kart verisi gizleme alt sureci (T11.17): paketin DERLENMIS
// gunlukcusuyla kart verisi tasiyan ve tasimayan satirlar yazar, sonra cikar.
// Bir satir cagriyi firlatirsa (QA O1: jokerli yolda URL ve Buffer) surec
// sifir olmayan kodla cikar ve test bunu gorur.
import { AppError } from '@getir/core';

import { createLogger } from '../../../dist/index.js';

const logger = createLogger({ name: 'gizleme-deneme', level: 'debug' });

logger.info({ number: '4242 4242 4242 4242', cvv: '123' }, 'ust duzey');
logger.info({ input: { number: '5555-5555-5555-4444', cvv: '9876', holderName: 'Ayse' } }, 'istek');
logger.info({ request: { number: 378282246310005, cvv: 765 } }, 'grpc istegi');
logger.child({ rpc: 'AddCard' }).warn({ card: { number: '9792000000000003' } }, 'cocuk');
logger.info(
  {
    order: { number: 'SIP-1042', total: 12990 },
    address: { number: '12/3' },
    number: 42,
    phone: { number: '0532 123 45 67' },
  },
  'kart degil',
);
logger.info({ target: new URL('https://example.com/kart?adim=1') }, 'url');
logger.info({ buf: Buffer.from('abc') }, 'buffer');
logger.info({ error: new AppError('NOT_FOUND', 'Kart bulunamadi') }, 'hata alani');
process.exit(0);
