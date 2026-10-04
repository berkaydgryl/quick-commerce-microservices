/**
 * QA: kurye servisinin komutlarini (dist/seed.js, dist/migrate.js) GERCEK surec
 * olarak kosar. Komut yalnizca ortam degiskenleriyle yonetilir; sonuc cikis
 * kodundan ve JSON gunluk satirlarindan okunur. CI'da `pnpm build` entegrasyon
 * testlerinden once kosar; yerelde once derleyin.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** Komut bu surede bitmezse oldurulur (asili kalan surec testi kilitlemesin). */
const CLI_TIMEOUT_MS = 30_000;

export const CLI_ENTRY = {
  SEED: fileURLToPath(new URL('../../dist/seed.js', import.meta.url)),
  MIGRATE: fileURLToPath(new URL('../../dist/migrate.js', import.meta.url)),
} as const;

export function assertBuilt(): void {
  for (const entry of Object.values(CLI_ENTRY)) {
    if (!existsSync(entry)) {
      throw new Error(`${entry} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
    }
  }
}

export interface CliRun {
  readonly code: number | null;
  /** stdout + stderr: gunluk JSON satirlari. */
  readonly output: string;
}

/** Komutu verilen kurye veritabaniyla kosar. */
export function runCourierCli(
  entry: string,
  args: readonly string[],
  mongo: { readonly uri: string; readonly dbName: string },
  nodeEnv: 'development' | 'production' = 'development',
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: {
        ...process.env,
        COURIER_MONGO_URI: mongo.uri,
        COURIER_MONGO_DB: mongo.dbName,
        NODE_ENV: nodeEnv,
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const logLineSchema = z.object({ msg: z.string() }).passthrough();

/** Gunlukteki `msg`'si verilen ilk JSON satiri; yoksa undefined. */
export function logLine(output: string, msg: string): Record<string, unknown> | undefined {
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    const parsed = logLineSchema.safeParse(JSON.parse(line));
    if (parsed.success && parsed.data.msg === msg) return parsed.data;
  }
  return undefined;
}
