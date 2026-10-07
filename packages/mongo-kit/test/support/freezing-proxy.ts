/**
 * Dondurulabilen TCP vekili (#51): `docker pause`'un test icindeki karsiligi.
 *
 * Donukken baglantilar ACIK kalir ve kabul edilir, ama iki yonde de veri iletilmez:
 * istemcinin yazdigi istek vekilde bekler, Mongo onu gormez ve cevap gelmez. Cozulunce
 * bekleyen veri sirasiyla akar; istemcinin o arada kapattigi baglantinin istegi de
 * Mongo'ya ulasir (donmus Mongo cozulunce yolda kalan yazim uygulanir).
 *
 * Neden konteyneri duraklatmak degil: Testcontainers konteynerini duraklatmak
 * Docker'a ozgu ve yavas; vekil her testte ayni anda donar ve cozulur.
 */

import { createServer, Socket } from 'node:net';
import type { AddressInfo, Server } from 'node:net';

const END = Symbol('end');
type Chunk = Buffer | typeof END;

export interface FreezingProxy {
  readonly port: number;
  /** Veri iletimini durdurur; baglantilar acik kalir. */
  freeze(): void;
  /** Bekleyen veriyi sirasiyla iletir ve iletmeye devam eder. */
  thaw(): void;
  close(): Promise<void>;
}

interface Relay {
  flush(): void;
  destroy(): void;
}

function forward(to: Socket, chunk: Chunk): void {
  if (to.destroyed) {
    return;
  }
  if (chunk === END) {
    to.end();
  } else {
    to.write(chunk);
  }
}

export interface FreezingProxyOptions {
  /**
   * Donukken istemcinin yazdigi her parca vekilde bekletildikten SONRA cagrilir: test, beklenen
   * istegin (orn. bir koleksiyona yazim) Mongo'nun kapisina geldigini uykusuz bilir. Bir komut
   * birden cok parcaya bolunebilir; gozlemci parcalari biriktirip aramalidir.
   */
  readonly onHeld?: (chunk: Buffer) => void;
}

export async function startFreezingProxy(
  target: {
    readonly host: string;
    readonly port: number;
  },
  options: FreezingProxyOptions = {},
): Promise<FreezingProxy> {
  let frozen = false;
  const relays = new Set<Relay>();

  const server: Server = createServer({ allowHalfOpen: true }, (client) => {
    const upstream = new Socket({ allowHalfOpen: true });
    const toUpstream: Chunk[] = [];
    const toClient: Chunk[] = [];
    const send = (queue: Chunk[], to: Socket, chunk: Chunk): void => {
      if (frozen) {
        queue.push(chunk);
      } else {
        forward(to, chunk);
      }
    };
    const relay: Relay = {
      flush: () => {
        for (const [queue, to] of [
          [toUpstream, upstream],
          [toClient, client],
        ] as const) {
          for (const chunk of queue.splice(0)) {
            forward(to, chunk);
          }
        }
      },
      destroy: () => {
        relays.delete(relay);
        client.destroy();
        upstream.destroy();
      },
    };
    relays.add(relay);
    client.on('data', (chunk: Buffer) => {
      const holding = frozen;
      send(toUpstream, upstream, chunk);
      // Once kuyruga, sonra gozlemciye: gozlemci hata firlatsa da parca kaybolmaz.
      if (holding) options.onHeld?.(chunk);
    });
    client.on('end', () => send(toUpstream, upstream, END));
    upstream.on('data', (chunk: Buffer) => send(toClient, client, chunk));
    upstream.on('end', () => send(toClient, client, END));
    // Sifirlanan (RST) baglanti iki ucta da kapatilir; bekleyen veri gider.
    client.on('error', () => relay.destroy());
    upstream.on('error', () => relay.destroy());
    upstream.on('close', () => relays.delete(relay));
    upstream.connect(target.port, target.host);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    freeze: () => {
      frozen = true;
    },
    thaw: () => {
      frozen = false;
      for (const relay of [...relays]) {
        relay.flush();
      }
    },
    close: async () => {
      for (const relay of [...relays]) {
        relay.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
