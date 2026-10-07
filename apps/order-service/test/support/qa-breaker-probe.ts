/**
 * QA (D17; bekleyen is 123): istemci testlerinde devre kesicinin SUNUCU SAYACIYLA kaniti. Testin
 * istemcisi port 0'daki sahte servise baglanir (tanimdan; davranisi RPC basina, qa-grpc-faults.ts).
 * Devre acikken cagrinin aga GITMEDIGI sunucuya ulasan cagri sayisiyla gorulur: eski bicim (kapali
 * port + hiz olcumu, "durum kapali") kesici hic takili olmasa da geciyordu.
 */

import type { ServiceDefinition } from '@grpc/grpc-js';

import { startFaultyServer, stubRegistration } from './qa-grpc-faults.js';
import type { DependencyFaults } from './qa-grpc-faults.js';

export { businessError, UNAVAILABLE } from './qa-grpc-faults.js';

/** Sahte servisi acar, istemciyi ona baglar; govdeden sonra ikisini de kapatir. */
export async function withProbe<TClient extends { close(): void }>(
  name: string,
  definition: ServiceDefinition,
  connect: (address: string) => TClient,
  body: (client: TClient, faults: DependencyFaults) => Promise<void>,
): Promise<void> {
  const server = await startFaultyServer(stubRegistration(name, definition));
  const client = connect(server.address);
  try {
    await body(client, server.faults);
  } finally {
    client.close();
    await server.stop();
  }
}
