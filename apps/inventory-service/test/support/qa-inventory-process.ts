/**
 * QA: stok servisini ve komutlarini GERCEK surec olarak kosar (dist/main.js, seed, reseed,
 * migrate). Surec yalnizca ortam degiskenleriyle yonetilir; sonuc cikis kodundan ve JSON gunluk
 * satirlarindan okunur. CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once
 * derleyin.
 *
 * Genel baslatici (startProcess) servisten bagimsizdir: order'in devre kesici kaniti da kullanir
 * (D17, #123). Ortak test yardimcisina tasinmasi bekleyen is #106.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { METRICS_PORT_OFFSET } from '@getir/service-kit';
import { z } from 'zod';

export const ENTRY = {
  MAIN: fileURLToPath(new URL('../../dist/main.js', import.meta.url)),
  SEED: fileURLToPath(new URL('../../dist/seed.js', import.meta.url)),
  RESEED: fileURLToPath(new URL('../../dist/reseed.js', import.meta.url)),
  MIGRATE: fileURLToPath(new URL('../../dist/migrate.js', import.meta.url)),
} as const;

export const READY_MESSAGE = 'stok servisi hazir';
const START_TIMEOUT_MS = 20_000;
/** Komut bu surede bitmezse oldurulur (asili kalan surec testi kilitlemesin). */
const CLI_TIMEOUT_MS = 30_000;
const LOCALHOST = '127.0.0.1';
const ANY_HOST = '0.0.0.0';
/**
 * Alt surec ortam semasiyla (port >= 1) acilir ve metrik portu gRPC portundan turer: sabit bos
 * port gerekir. Aralik isletim sisteminin gecici araliginin ALTINDA (courier QA ile ayni gerekce,
 * #135 EADDRINUSE); kalan yaris icin yeni portla tekrar.
 */
const EPHEMERAL_FLOOR = 32_768;
const PORT_MIN = 10_000;
const PORT_SPAN = EPHEMERAL_FLOOR - METRICS_PORT_OFFSET - PORT_MIN;
const START_ATTEMPTS = 5;
const PORT_IN_USE = 'EADDRINUSE';

export function assertBuilt(): void {
  for (const entry of Object.values(ENTRY)) {
    if (!existsSync(entry)) {
      throw new Error(`${entry} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
    }
  }
}

/** Mongo ve Redis adresleri. */
export interface StoresAddress {
  readonly mongoUri: string;
  readonly mongoDb: string;
  readonly redisUrl: string;
}

/** Kabuktan alt surece gecen degiskenler: yalnizca calistirma icin gerekenler. */
const INHERITED_ENV = ['PATH', 'HOME', 'TMPDIR'] as const;

/**
 * Alt surecin ortami SIFIRDAN kurulur: gelistiricinin kabugundaki ya da CI'daki servis
 * degiskenleri (SWEEPER_*, MONGO_*, NODE_OPTIONS...) sonucu degistirmesin.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    INHERITED_ENV.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function inventoryEnv(stores: StoresAddress): Record<string, string> {
  return {
    MOCK: 'false',
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    INVENTORY_MONGO_URI: stores.mongoUri,
    INVENTORY_MONGO_DB: stores.mongoDb,
    REDIS_URL: stores.redisUrl,
    REDIS_CONNECT_TIMEOUT_MS: '3000',
  };
}

/** Gercek surec olarak acilacak servis. */
export interface ProcessSpec {
  /** Calistirilacak giris (dist/main.js). */
  readonly entry: string;
  /** "Hazir" gunluk satirinin msg'si. */
  readonly readyMessage: string;
  /** gRPC portunun ortam degiskeni (orn. ORDER_GRPC_PORT); port testte bos porttan secilir. */
  readonly portEnv: string;
  /** Servisin ortami; kabuktan yalnizca PATH, HOME ve TMPDIR gelir. */
  readonly env: Readonly<Record<string, string>>;
}

export interface RunningProcess {
  readonly child: ChildProcess;
  readonly port: number;
  readonly ready: boolean;
  /** Acilmadiysa cikis kodu; sinyalle olduruldu ya da hala aciksa null. */
  readonly exitCode: number | null;
  /** Hazir satirina ya da cikisa kadar gecen sure (ms). */
  readonly elapsedMs: number;
  /** stdout + stderr; surec yasadikca buyur. */
  output(): string;
}

/** Stok servisinin sureci (eski ad; genel tip RunningProcess). */
export type RunningInventory = RunningProcess;

const running: ChildProcess[] = [];

function isFreeOn(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    const busy = (): void => resolve(false);
    probe.once('error', busy);
    probe.listen(port, host, () => {
      probe.off('error', busy);
      probe.close(() => resolve(true));
    });
  });
}

async function isFree(port: number): Promise<boolean> {
  return (await isFreeOn(port, ANY_HOST)) && (await isFreeOn(port, LOCALHOST));
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = PORT_MIN + Math.floor(Math.random() * PORT_SPAN);
    if ((await isFree(port)) && (await isFree(port + METRICS_PORT_OFFSET))) return port;
  }
  throw new Error('bos port bulunamadi');
}

/** Stok servisini acar (startProcess). */
export function startInventory(
  stores: StoresAddress,
  extra: Readonly<Record<string, string>> = {},
): Promise<RunningInventory> {
  return startProcess({
    entry: ENTRY.MAIN,
    readyMessage: READY_MESSAGE,
    portEnv: 'INVENTORY_GRPC_PORT',
    env: { ...inventoryEnv(stores), ...extra },
  });
}

/**
 * Servisi acar; "hazir" satirini ya da cikisi bekler. Port arada baskasina gectiyse (EADDRINUSE)
 * yeni portla tekrar dener; acilmayan servis (ready false) oldugu gibi doner.
 */
export async function startProcess(spec: ProcessSpec): Promise<RunningProcess> {
  for (let attempt = 1; ; attempt += 1) {
    const started = await startOn(await freePort(), spec);
    if (started.ready || !started.output().includes(PORT_IN_USE) || attempt === START_ATTEMPTS) {
      return started;
    }
  }
}

function startOn(port: number, spec: ProcessSpec): Promise<RunningProcess> {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [spec.entry], {
    env: {
      ...inheritedEnv(),
      GRPC_HOST: ANY_HOST,
      [spec.portEnv]: String(port),
      ...spec.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  // Cikti surecin OMRU boyunca toplanir (liderlik gunlugu); dinleyiciler kapanista kalkar.
  let output = '';
  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8');
  };
  const detach = (): void => {
    child.stdout?.off('data', collect);
    child.stderr?.off('data', collect);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.once('close', detach);
  return new Promise((resolve) => {
    // Sure dolarsa olur; ardindan gelen 'close' sonucu yazar.
    const timer = setTimeout(() => child.kill('SIGKILL'), START_TIMEOUT_MS);
    const onData = (): void => {
      if (logLines(output, spec.readyMessage).length > 0) finish(true);
    };
    // 'exit' degil 'close' (#135, courier QA ile ayni): exit geldiginde cikti borusu henuz
    // okunmamis olabilir; son satir (fatal, EADDRINUSE) kacarsa ne tekrar ne de denetim gorur.
    const onClose = (): void => finish(false);
    const onError = (error: Error): void => {
      output += `\nspawn hatasi: ${error.message}\n`;
      finish(false);
    };
    function finish(ready: boolean): void {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('close', onClose);
      child.off('error', onError);
      resolve({
        child,
        port,
        ready,
        exitCode: child.exitCode,
        elapsedMs: Date.now() - startedAt,
        output: () => output,
      });
    }
    child.stdout?.on('data', onData);
    child.once('close', onClose);
    child.once('error', onError);
  });
}

/** Acik kalan butun surecleri kapatir (SIGKILL: test temizligi zarif kapanisi sinamaz). */
export async function stopAllProcesses(): Promise<void> {
  await Promise.all(
    running.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
          child.kill('SIGKILL');
        }),
    ),
  );
}

/** Sureci SIGKILL ile oldurur ve cikisini bekler (kapanis kancalari CALISMAZ). */
export function killHard(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

export interface CliRun {
  readonly code: number | null;
  readonly output: string;
}

/** Komutu (seed, reseed, migrate) verilen depolarla kosar. */
export function runCli(
  entry: string,
  args: readonly string[],
  stores: StoresAddress,
  extra: Readonly<Record<string, string>> = {},
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...inheritedEnv(), ...inventoryEnv(stores), ...extra },
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

/** Gunlukte `msg`'si verilen JSON satirlari (sirayla). */
export function logLines(output: string, msg: string): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = logLineSchema.safeParse(value);
    if (parsed.success && parsed.data.msg === msg) lines.push(parsed.data);
  }
  return lines;
}

/** Kosul saglanana kadar kisa araliklarla yoklar; sure dolarsa false. */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}

/** Eski ad (stok testleri). */
export const stopAllInventories = stopAllProcesses;
