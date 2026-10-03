/**
 * Test istemcileri: gercek socket.io-client ile yalnizca websocket (web'in
 * kullanacagi ayarla ayni) baglanir, room.join'i ack'iyle bekler.
 */

import { SOCKET_EVENTS } from '@getir/contracts';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

/** Bir olayin gelmesi icin beklenecek en uzun sure (ms). */
export const EVENT_TIMEOUT_MS = 2_000;

/** "Gelmedi" demek icin beklenen sure (ms): yayin yerelde birkac ms surer. */
export const SILENCE_MS = 300;

export interface ConnectOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly transports?: readonly ('websocket' | 'polling')[];
}

/** Baglanir ve 'connect'i bekler; baglanamazsa hata ile reddeder. */
export function connectClient(port: number, options: ConnectOptions = {}): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: [...(options.transports ?? ['websocket'])],
    reconnection: false,
    forceNew: true,
    ...(options.headers === undefined ? {} : { extraHeaders: { ...options.headers } }),
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

/** room.join gonderir ve ack govdesini doner. */
export function joinRoom(socket: Socket, payload: unknown): Promise<unknown> {
  return socket.timeout(EVENT_TIMEOUT_MS).emitWithAck(SOCKET_EVENTS.ROOM_JOIN, payload);
}

/** Olayin ilk govdesini bekler; sure dolarsa reddeder. */
export function nextEvent(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`${event} ${EVENT_TIMEOUT_MS} ms icinde gelmedi`));
    }, EVENT_TIMEOUT_MS);
    function onEvent(payload: unknown): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

/** SILENCE_MS boyunca gelen olaylari toplar ("gelmedi" kaniti). */
export function collectEvents(socket: Socket, event: string): Promise<unknown[]> {
  const received: unknown[] = [];
  const onEvent = (payload: unknown): void => {
    received.push(payload);
  };
  socket.on(event, onEvent);
  return new Promise((resolve) => {
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(received);
    }, SILENCE_MS);
  });
}

/** Sunucu soketi kapatana kadar bekler (disconnect nedeni doner). */
export function disconnection(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    if (socket.disconnected) {
      resolve('zaten kopuk');
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`soket ${EVENT_TIMEOUT_MS} ms icinde kopmadi`));
    }, EVENT_TIMEOUT_MS);
    socket.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}
