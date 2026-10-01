// stdout-closed.spec.ts'in alt sureci (#56): service-kit'in DERLENMIS ciktisiyla
// gercek servisin yasam dongusu - gunlukcu + installProcessHandlers + gRPC
// sunucusu ve metrik ucu (bos portlarda). Veri kaynagi yok (MOCK gibi): kapanis
// mikro gorevlerle biter, servisin #56'da takildigi durum budur.
import { createLogger, installProcessHandlers, startGrpcServer } from '../../../dist/index.js';

const logger = createLogger({ name: 'stdout-deneme' });

const handle = await startGrpcServer({
  serviceName: 'stdout-deneme',
  host: '127.0.0.1',
  port: 0,
  services: [],
  logger,
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, metricsPort: handle.metricsPort }, 'hazir');
