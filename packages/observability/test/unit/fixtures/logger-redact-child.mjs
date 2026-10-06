// logger.spec.ts'in kart verisi gizleme alt sureci (T11.17): paketin DERLENMIS
// gunlukcusuyla kart verisi tasiyan ve tasimayan satirlar yazar, sonra cikar.
import { createLogger } from '../../../dist/index.js';

const logger = createLogger({ name: 'gizleme-deneme', level: 'debug' });

logger.info({ number: '4242 4242 4242 4242', cvv: '123' }, 'ust duzey');
logger.info({ input: { number: '5555-5555-5555-4444', cvv: '9876', holderName: 'Ayse' } }, 'istek');
logger.info({ call: { request: { number: 378282246310005, cvv: 765 } } }, 'iki kat');
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
process.exit(0);
