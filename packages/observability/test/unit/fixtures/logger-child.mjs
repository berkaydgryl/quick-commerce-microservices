// logger.spec.ts'in alt sureci: paketin DERLENMIS gunlukcusuyla yazar.
// SIGTERM'de iki satir yazip AYNI gorevde cikar: esizamansiz hedefte ilk satirin
// yazim hatasi (EPIPE) cikistan once islenmez - #56'nin kosulu budur.
import { createLogger } from '../../../dist/index.js';

const logger = createLogger({ name: 'gunluk-deneme', level: 'debug' });

process.on('SIGTERM', () => {
  logger.info({ adim: 1 }, 'kapanis 1');
  logger.info({ adim: 2 }, 'kapanis 2');
  process.exit(0);
});

logger.info({ orderId: 'ord_deneme' }, 'hazir');

// Sinyal gelene kadar ayakta kal.
setInterval(() => undefined, 60_000);
