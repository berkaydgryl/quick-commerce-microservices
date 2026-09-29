/** Oturum testlerinin ortak parcalari: sozlesmeye uyan oturum cevabi ve zarf. */

import type { AuthSession } from '@getir/contracts';

import type { SessionLockManager } from '../../src/shared/session/session-lock';

export const USER = {
  id: 'usr_a9e0eddcc7fe5bf4c620ae453c227c6a',
  phone: '+905550000001',
  fullName: 'Ayşe Yılmaz',
} as const;

export function sessionWith(accessToken: string): AuthSession {
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshExpiresIn: 1_209_600,
    user: { ...USER },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function success(data: unknown, status = 200): Response {
  return jsonResponse({ success: true, data }, status);
}

export function failure(code: string, status: number, details?: unknown): Response {
  return jsonResponse(
    { success: false, error: { code, message: 'x', details, requestId: 'req_1' } },
    status,
  );
}

/** Disaridan cozulen soz: "ayni anda" senaryolarinda istegi askida tutar. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Web Locks gibi davranan sahte yonetici: ayni ad sirayla calisir, adlar kaydedilir. */
export function fakeLockManager() {
  const names: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const manager: SessionLockManager = {
    request<T>(name: string, task: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = tail.then(task);
      tail = run.catch(() => undefined);
      return run;
    },
  };
  return { manager, names };
}
