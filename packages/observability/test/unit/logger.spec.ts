/**
 * Gunlukcu (T10.5) gercek bir alt surecte: cikti bicimi ve #56 - stdout'un
 * okuyucusu gittiginde surec SIGTERM ile yine cikar, stderr'e bir kez not duser.
 *
 * Alt surec paketin dist'ini kullanir (pnpm verify testten once derler).
 */

import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { STDOUT_LOST_MESSAGE } from '../../src/log-destination.js';

const CHILD = fileURLToPath(new URL('./fixtures/logger-child.mjs', import.meta.url));
/** Cikis icin beklenen en uzun sure; takilan surec bu surede cikmaz (#56). */
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

interface Started {
  readonly child: Child;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<Exit>;
}

async function startChild(): Promise<Started> {
  const child = spawn(process.execPath, [CHILD], { stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<Exit>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  await waitFor(() => stdout.includes('"msg":"hazir"'), 'alt surec hazir olmadi');
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

async function waitFor(check: () => boolean, failure: string): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(failure);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function within(exited: Promise<Exit>): Promise<Exit | 'cikmadi'> {
  return Promise.race([
    exited,
    new Promise<'cikmadi'>((resolve) => setTimeout(() => resolve('cikmadi'), EXIT_WAIT_MS)),
  ]);
}

describe('createLogger', () => {
  it('tek satir JSON yazar: seviye adi, ISO zaman, servis adi, alanlar mesajdan once', async () => {
    const { stdout, child, exited } = await startChild();
    child.kill('SIGTERM');
    await within(exited);

    const lines = stdout()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      level: 'info',
      name: 'gunluk-deneme',
      orderId: 'ord_deneme',
      msg: 'hazir',
    });
    expect(String(lines[0]?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('esli yazar: ayni gorevde cikan surecin son satirlari kaybolmaz', async () => {
    const { stdout, child, exited } = await startChild();

    child.kill('SIGTERM');

    expect(await within(exited)).toEqual({ code: 0, signal: null });
    expect(stdout()).toContain('"msg":"kapanis 1"');
    expect(stdout()).toContain('"msg":"kapanis 2"');
  });
});

describe('stdout okuyucusu gidince (#56)', () => {
  it('surec SIGTERM ile yine cikar; gunluk birakilir, stderr bir kez not duser', async () => {
    const { child, stderr, exited } = await startChild();

    // Gunluk toplayici coktu: borunun okuma ucu kapanir, sonraki yazim EPIPE.
    child.stdout.destroy();
    child.kill('SIGTERM');

    expect(await within(exited)).toEqual({ code: 0, signal: null });
    const notes = stderr()
      .trim()
      .split('\n')
      .filter((line) => line.includes(STDOUT_LOST_MESSAGE));
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0] ?? '{}')).toMatchObject({
      level: 'warn',
      name: 'gunluk-deneme',
      code: 'EPIPE',
    });
  });
});
