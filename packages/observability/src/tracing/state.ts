/**
 * Surecin iz saglayicisi (D15) - TEK kayit. Paketin ici: startTracing ve test
 * yardimcisi ayni kaydi gorur, ikinci kurulum ilkini ezmez.
 */

import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

let registered: NodeTracerProvider | undefined;

export function registeredProvider(): NodeTracerProvider | undefined {
  return registered;
}

export function registerProvider(provider: NodeTracerProvider): void {
  registered = provider;
}
