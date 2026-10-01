/**
 * #56 servis yasam dongusuyle (T10.5): stdout'un okuyucusu giden servis SIGTERM
 * ile zarif kapanir ve cikar. Once (T10.4 canli testinde) surec hic cikmiyordu:
 * pino'nun varsayilan hedefi cikista kapali boruya yazmayi sonsuza dek deniyordu.
 *
 * Alt surec service-kit'in dist'ini kullanir (pnpm verify testten once derler).
 */

import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { STDOUT_LOST_MESSAGE } from '@getir/observability';
import { afterEach, describe, expect, it } from 'vitest';

const SERVICE = fileURLToPath(new URL('./fixtures/stdout-service.mjs', import.meta.url));
/** Cikis icin beklenen en uzun sure; takilan surec bu surede cikmaz. */
const EXIT_WAIT_MS = 5_000;

type Child = ChildProcessByStdio<null, Readable, Readable>;

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

const running: Child[] = [];

afterEach(() => {
  for (const child of running.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
});

async function startService(): Promise<{
  child: Child;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<Exit>;
}> {
  const child = spawn(process.execPath, [SERVICE], { stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<Exit>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (!stdout.includes('"msg":"hazir"')) {
    if (Date.now() > deadline) {
      throw new Error(`servis hazir olmadi: ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

function within(exited: Promise<Exit>): Promise<Exit | 'cikmadi'> {
  return Promise.race([
    exited,
    new Promise<'cikmadi'>((resolve) => setTimeout(() => resolve('cikmadi'), EXIT_WAIT_MS)),
  ]);
}

describe('servis kapanisi ve stdout (#56)', () => {
  it('stdout acikken SIGTERM: kapanis satirlari yazilir, cikis kodu 0', async () => {
    const { child, stdout, exited } = await startService();

    child.kill('SIGTERM');

    expect(await within(exited)).toEqual({ code: 0, signal: null });
    expect(stdout()).toContain('"msg":"kapanis sinyali alindi"');
    expect(stdout()).toContain('"msg":"zarif kapanis bitti"');
  });

  it("stdout'un okuyucusu gittiyse SIGTERM'de yine zarif kapanir ve cikar", async () => {
    const { child, stderr, exited } = await startService();

    // Gunluk toplayici coktu ya da ust surec oldu: borunun okuma ucu kapanir.
    child.stdout.destroy();
    child.kill('SIGTERM');

    expect(await within(exited)).toEqual({ code: 0, signal: null });
    expect(stderr()).toContain(STDOUT_LOST_MESSAGE);
  });
});
