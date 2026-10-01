// logger.spec.ts'in iz alt sureci (D15): paketin DERLENMIS gunlukcusu ve iz
// saglayicisi. Span icinde ve disinda birer satir yazar, cikar.
import { context, trace } from '@opentelemetry/api';

import { createLogger, startTracing } from '../../../dist/index.js';

startTracing({ serviceName: 'gunluk-iz' });
const logger = createLogger({ name: 'gunluk-iz' });

const span = trace.getTracer('deneme').startSpan('istek');
context.with(trace.setSpan(context.active(), span), () => {
  const { traceId, spanId } = span.spanContext();
  logger.info({ beklenenTraceId: traceId, beklenenSpanId: spanId }, 'span icinde');
});
span.end();
logger.info({}, 'span disinda');
