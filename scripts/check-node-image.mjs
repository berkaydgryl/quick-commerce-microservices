#!/usr/bin/env node
/**
 * Node servis imaji denetimi (D12) - CI'in "Imaj (<servis>)" isi calistirir.
 *
 *   node scripts/check-node-image.mjs <imaj>
 *   ornek: node scripts/check-node-image.mjs getir/risk-service
 *
 * Neye bakar:
 *   1. Calisma klasorunde (WORKDIR, /app) YALNIZCA dist, node_modules, package.json ve
 *      servisin package.json "files" alaninda acikca yazdigi girisler (orn. ileride bir
 *      lua/ klasoru) var; README'yi paketleme kurali her zaman ekler, o da izinli. IZIN
 *      LISTESIDIR, yasak listesi degil: yarin cikacak bilinmeyen bir artik da yakalanir.
 *      Kaynak ve derleme artiklari (src, test, .turbo, tsconfig) "files"a yazilsa bile
 *      yasaktir.
 *   2. dist'te giris noktalari (main.js, healthcheck.js) var, tip bildirimi (.d.ts) yok.
 *   3. Imaj root ile calismaz, WORKDIR ve HEALTHCHECK tanimlidir (proje-kurallari.mdc
 *      "Docker").
 *   4. Servis MOCK=true ile (Mongo/Redis'siz, agsiz) acilir ve imajin KENDI saglik
 *      komutu gecer. Eksik bir uretim bagimliligi ya da imaja girmemis bir calisma
 *      dosyasi (orn. risk.rules.json) servisi acilista dusurur; hata deploy'da degil
 *      burada gorunur.
 *
 * NEDEN: pnpm deploy servisin kendi dosyalarindan yalnizca package.json'daki "files"
 * alanini kopyalar. Alan silinirse imaja yine src/tsconfig/.turbo girer; calisma aninda
 * okunan yeni bir dosya (orn. .lua) o alana yazilmazsa servis ancak acilirken duser.
 * Ikisi de "pnpm verify"da gorunmez ve bu betikten once CI hicbir Dockerfile'i
 * derlemiyordu.
 *
 * Bagimliliksiz duz Node: CI isi pnpm kurmaz. Docker ciktisi dis veridir; alanlar tek
 * tek tip kontrolunden gecer.
 */

import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Calisma klasorunde bulunmasi ZORUNLU girisler. */
export const REQUIRED_ENTRIES = ['dist', 'node_modules', 'package.json'];

/**
 * Izinli tek ek: npm'in paketleme kurali (pnpm deploy de onu uygular) README'yi
 * "files" alanindan bagimsiz her zaman kopyalar.
 */
export const OPTIONAL_ENTRIES = ['README.md'];

/** dist'te bulunmasi zorunlu giris noktalari: Dockerfile'daki CMD ve HEALTHCHECK. */
export const REQUIRED_DIST_FILES = ['main.js', 'healthcheck.js'];

/**
 * Kaynak ve derleme artiklari: "files" alanina yazilsa bile imaja giremez
 * (proje-kurallari.mdc "Docker": kaynak calisma imajina girmez).
 */
const BUILD_ARTIFACT = /^(?:src|test|tests|\.turbo|tsconfig(?:\.[\w-]+)?\.json)$/;

const DECLARATION_FILE = /\.d\.ts(?:\.map)?$/;
const ROOT_USERS = new Set(['', 'root', '0']);

/** Servisler 1-2 sn'de acilir; CI runner'i yavas olabilir, pay birakilir. */
const BOOT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const LOG_TAIL_LINES = 20;

/**
 * @typedef {(args: readonly string[]) => Promise<{ stdout: string, stderr: string }>} Docker
 * @typedef {{ user: string, workDir: string, healthcheck: string[] | null }} ImageConfig
 */

/**
 * package.json "files" girdilerinin calisma klasorundeki ust adlari:
 * "dist" -> "dist", "lua/*.lua" -> "lua". Olumsuzlama ("!x") ve kokteki desen
 * ("*.lua": hangi adlari getirecegi bilinmez) sayilmaz.
 * @param {unknown} files - imajdaki package.json'in "files" alani
 * @returns {string[]}
 */
export function declaredEntries(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  const names = files
    .filter((file) => typeof file === 'string' && !file.startsWith('!'))
    .map((file) => file.replace(/^\.\//, '').split('/')[0] ?? '')
    .filter((name) => name !== '' && !name.includes('*'));
  return [...new Set(names)];
}

/**
 * Calisma klasorunun girislerindeki sorunlar; bos dizi: sorun yok.
 * @param {readonly string[]} entries - `ls -A` ciktisi
 * @param {readonly string[]} [declared] - "files" alaninin ust adlari (declaredEntries)
 * @returns {string[]}
 */
export function appEntryProblems(entries, declared = []) {
  const problems = [];
  const missing = REQUIRED_ENTRIES.filter((entry) => !entries.includes(entry));
  if (missing.length > 0) {
    problems.push(`eksik: ${missing.join(', ')}`);
  }
  const artifacts = entries.filter((entry) => BUILD_ARTIFACT.test(entry)).sort();
  if (artifacts.length > 0) {
    problems.push(`kaynak ya da derleme artigi: ${artifacts.join(', ')}`);
  }
  const allowed = new Set([...REQUIRED_ENTRIES, ...OPTIONAL_ENTRIES, ...declared]);
  const unexpected = entries
    .filter((entry) => !allowed.has(entry) && !BUILD_ARTIFACT.test(entry))
    .sort();
  if (unexpected.length > 0) {
    problems.push(
      `calisma icin gereksiz: ${unexpected.join(', ')} ` +
        `(calisma aninda gerekiyorsa package.json "files" alanina yazilir)`,
    );
  }
  return problems;
}

/**
 * dist'teki sorunlar.
 * @param {readonly string[]} files - dist'e gore goreli dosya yollari
 * @returns {string[]}
 */
export function distProblems(files) {
  const problems = [];
  const missing = REQUIRED_DIST_FILES.filter((file) => !files.includes(file));
  if (missing.length > 0) {
    problems.push(`eksik giris noktasi: ${missing.join(', ')}`);
  }
  const declarations = files.filter((file) => DECLARATION_FILE.test(file)).sort();
  if (declarations.length > 0) {
    problems.push(
      `${declarations.length} tip bildirimi (.d.ts) var, uygulamada uretilmez ` +
        `(ornek: ${declarations[0]})`,
    );
  }
  return problems;
}

/**
 * Docker HEALTHCHECK "Test" alanini konteynerde calisacak komuta cevirir:
 * ["CMD", "node", "x.js"] -> ["node", "x.js"]; ["CMD-SHELL", "..."] -> ["sh", "-c", "..."];
 * tanimsiz ya da ["NONE"] -> null.
 * @param {readonly string[] | null} test
 * @returns {string[] | null}
 */
export function healthcheckCommand(test) {
  const [kind, ...rest] = test ?? [];
  if (kind === 'CMD' && rest.length > 0) {
    return rest;
  }
  if (kind === 'CMD-SHELL' && rest.length === 1) {
    return ['sh', '-c', ...rest];
  }
  return null;
}

/**
 * Imaj ayarindaki sorunlar: root kullanici, tanimsiz WORKDIR ya da saglik kontrolu.
 * @param {ImageConfig} config
 * @returns {string[]}
 */
export function configProblems({ user, workDir, healthcheck }) {
  const problems = [];
  const [name = ''] = user.split(':');
  if (ROOT_USERS.has(name)) {
    problems.push(`konteyner root ile calisiyor (USER "${user}"), USER node olmali`);
  }
  if (!workDir.startsWith('/')) {
    problems.push('WORKDIR tanimli degil');
  }
  if (healthcheckCommand(healthcheck) === null) {
    problems.push('HEALTHCHECK tanimli degil');
  }
  return problems;
}

/**
 * `docker image inspect --format '{{json .Config}}'` ciktisini okur; beklenmeyen
 * alan bos deger olur (denetim onu sorun olarak raporlar, betik dusmez).
 * @param {unknown} config
 * @returns {ImageConfig}
 */
export function parseImageConfig(config) {
  const record = isRecord(config) ? config : {};
  const health = isRecord(record['Healthcheck']) ? record['Healthcheck'] : {};
  const test = health['Test'];
  return {
    user: typeof record['User'] === 'string' ? record['User'] : '',
    workDir: typeof record['WorkingDir'] === 'string' ? record['WorkingDir'] : '',
    healthcheck:
      Array.isArray(test) && test.every((part) => typeof part === 'string') ? test : null,
  };
}

/**
 * Servisi MOCK=true ile acar ve imajin saglik komutu gecene kadar bekler.
 * Konteyner her durumda silinir.
 * @param {string} image
 * @param {readonly string[]} command - konteynerde calisacak saglik komutu
 * @param {{ docker: Docker, sleep?: (ms: number) => Promise<unknown>, now?: () => number,
 *   timeoutMs?: number, intervalMs?: number }} deps
 * @returns {Promise<string | null>} sorun; servis acildiysa null
 */
export async function bootProblem(image, command, deps) {
  const {
    docker,
    sleep = delay,
    now = Date.now,
    timeoutMs = BOOT_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
  } = deps;
  // --network none: MOCK acilisi disariya hic baglanmamali; saglik komutu konteynerin
  // kendi loopback'inden gider.
  const { stdout } = await docker([
    'run',
    '--detach',
    '--pull=never',
    '--network=none',
    '--env',
    'MOCK=true',
    image,
  ]);
  const container = stdout.trim();
  const startedAt = now();
  try {
    for (;;) {
      if (await succeeds(docker, ['exec', container, ...command])) {
        return null;
      }
      if (!(await isRunning(docker, container))) {
        return `servis acilista durdu; son satirlar:\n${await logTail(docker, container)}`;
      }
      if (now() - startedAt >= timeoutMs) {
        return (
          `saglik komutu ${timeoutMs / 1000} sn icinde gecmedi; son satirlar:\n` +
          (await logTail(docker, container))
        );
      }
      await sleep(intervalMs);
    }
  } finally {
    await succeeds(docker, ['rm', '--force', container]);
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} text */
function lines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** @param {Docker} docker @param {readonly string[]} args */
async function succeeds(docker, args) {
  try {
    await docker(args);
    return true;
  } catch {
    return false;
  }
}

/** @param {Docker} docker @param {string} container */
async function isRunning(docker, container) {
  try {
    const { stdout } = await docker(['inspect', '--format', '{{.State.Running}}', container]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Konteynerin son satirlari; servis stdout'a, cokus mesaji stderr'e yazar.
 * @param {Docker} docker
 * @param {string} container
 */
async function logTail(docker, container) {
  try {
    const { stdout, stderr } = await docker(['logs', '--tail', String(LOG_TAIL_LINES), container]);
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    return `(gunluk okunamadi: ${errorText(error)})`;
  }
}

/** @param {unknown} error */
function errorText(error) {
  if (isRecord(error) && typeof error['stderr'] === 'string' && error['stderr'].trim() !== '') {
    return error['stderr'].trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/** @type {Docker} */
async function runDocker(args) {
  const { stdout, stderr } = await execFileAsync('docker', [...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** @param {string} image @param {Docker} docker @returns {Promise<ImageConfig>} */
async function readImageConfig(image, docker) {
  const { stdout } = await docker(['image', 'inspect', '--format', '{{json .Config}}', image]);
  return parseImageConfig(JSON.parse(stdout));
}

/**
 * Imajdan tek komutluk konteynerle okur. --pull=never: yerelde olmayan bir ad
 * Docker Hub'daki baska birinin imajini indirip calistirmasin.
 * @param {string} image
 * @param {string} entrypoint
 * @param {readonly string[]} args
 * @param {Docker} docker
 * @returns {Promise<string>} stdout
 */
async function runInImage(image, entrypoint, args, docker) {
  const { stdout } = await docker([
    'run',
    '--rm',
    '--pull=never',
    '--network=none',
    '--entrypoint',
    entrypoint,
    image,
    ...args,
  ]);
  return stdout;
}

/**
 * dist'teki dosyalar, dist'e gore goreli; dist yoksa bos (eksikligini
 * appEntryProblems soyler).
 * @param {string} image
 * @param {string} workDir
 * @param {Docker} docker
 */
async function listDistFiles(image, workDir, docker) {
  const dist = posix.join(workDir, 'dist');
  try {
    const paths = lines(await runInImage(image, 'find', [dist, '-type', 'f'], docker));
    return paths.map((path) => path.slice(dist.length + 1));
  } catch {
    return [];
  }
}

/**
 * Imajdaki package.json'in "files" alaninin ust adlari; dosya yoksa ya da bozuksa
 * bos (eksik package.json'i appEntryProblems zaten soyler).
 * @param {string} image
 * @param {string} workDir
 * @param {Docker} docker
 */
async function readDeclaredEntries(image, workDir, docker) {
  try {
    const manifest = JSON.parse(
      await runInImage(image, 'cat', [posix.join(workDir, 'package.json')], docker),
    );
    return declaredEntries(isRecord(manifest) ? manifest['files'] : undefined);
  } catch {
    return [];
  }
}

/**
 * @param {string} title
 * @param {readonly string[]} problems
 * @param {string} summary - sorun yoksa yazilan ozet
 * @returns {boolean} gecti mi
 */
function report(title, problems, summary) {
  if (problems.length === 0) {
    console.log(`✓ ${title}: ${summary}`);
    return true;
  }
  for (const problem of problems) {
    console.error(`✗ ${title}: ${problem}`);
  }
  return false;
}

/** @param {string[]} argv @param {Docker} docker */
async function main(argv, docker = runDocker) {
  const [image = ''] = argv;
  if (argv.length !== 1 || image === '') {
    console.error('kullanim: check-node-image.mjs <imaj>   ornek: getir/risk-service');
    return 2;
  }

  let config;
  try {
    config = await readImageConfig(image, docker);
  } catch (error) {
    console.error(`✗ imaj okunamadi (${image}): ${errorText(error)}`);
    return 2;
  }

  console.log(`denetleniyor: ${image}`);
  const command = healthcheckCommand(config.healthcheck);
  const settingsOk = report(
    'imaj ayari',
    configProblems(config),
    `USER ${config.user}, WORKDIR ${config.workDir}, HEALTHCHECK ${command?.join(' ') ?? ''}`,
  );
  if (!config.workDir.startsWith('/')) {
    return 1;
  }

  try {
    const entries = lines(await runInImage(image, 'ls', ['-A', config.workDir], docker));
    const declared = await readDeclaredEntries(image, config.workDir, docker);
    const distFiles = await listDistFiles(image, config.workDir, docker);
    const results = [
      settingsOk,
      report(
        `calisma klasoru (${config.workDir})`,
        appEntryProblems(entries, declared),
        [...entries].sort().join(', '),
      ),
      report(
        'dist',
        distProblems(distFiles),
        `giris noktalari var, tip bildirimi yok (${distFiles.length} dosya)`,
      ),
    ];
    if (command !== null) {
      const startedAt = Date.now();
      const problem = await bootProblem(image, command, { docker });
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      results.push(
        report(
          'acilis',
          problem === null ? [] : [problem],
          `MOCK=true ile acildi, saglik komutu ${seconds} sn'de gecti`,
        ),
      );
    }

    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) {
      console.error(`\n${failed} denetim gecmedi (kural: proje-kurallari.mdc "Docker", D12).`);
      return 1;
    }
    console.log('✓ imaj kurala uygun');
    return 0;
  } catch (error) {
    console.error(`✗ docker komutu basarisiz: ${errorText(error)}`);
    return 2;
  }
}

// Yalnizca dogrudan calistirildiginda (testler import eder, calistirmaz).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
