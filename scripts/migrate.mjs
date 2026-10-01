#!/usr/bin/env node
/**
 * Kokten goc komutu (T10.4, ADR-19): butun servislerde `up` ya da `status`.
 *
 *   pnpm migrate up       derler, sonra her servisin bekleyen goclerini uygular
 *   pnpm migrate status   derler, sonra her servisin goc durumunu yazar
 *
 * `down` BURADA YOK: geri alma tek servisin kararidir, hepsinde birden son
 * gocu geri almak kazayla veri kaybettirir. Servis bazinda:
 *   pnpm --filter @getir/<servis> migrate down
 *
 * Servisler kendi `migrate` betiginden bulunur (pnpm -r); liste elle tutulmaz.
 * Her servis KENDI veritabanina kendi kullanicisiyla baglanir (D14).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT_COMMANDS = ['up', 'status'];

/**
 * Komut satirindan calistirilacak adimlar ya da kullanim hatasi.
 * @param {readonly string[]} args
 * @returns {{ steps: string[][] } | { error: string }}
 */
export function migratePlan(args) {
  const [command, ...rest] = args;
  if (command === 'down') {
    return {
      error:
        'down kokten calismaz (butun servislerde son gocu geri alirdi). Servis bazinda: pnpm --filter @getir/<servis> migrate down',
    };
  }
  if (command === undefined || !ROOT_COMMANDS.includes(command) || rest.length > 0) {
    return { error: `kullanim: pnpm migrate ${ROOT_COMMANDS.join(' | ')}` };
  }
  return {
    steps: [
      // Servisler dist'ten calisir: once derlenir (seed'le ayni kural).
      ['pnpm', 'exec', 'turbo', 'run', 'build', '--filter=./apps/*-service'],
      // Sirayla; ilk hatada durur (bail).
      [
        'pnpm',
        '-r',
        '--filter',
        './apps/*',
        '--if-present',
        '--workspace-concurrency=1',
        'run',
        'migrate',
        command,
      ],
    ],
  };
}

/** @param {readonly string[]} args */
function main(args) {
  const plan = migratePlan(args);
  if ('error' in plan) {
    console.error(plan.error);
    return 2;
  }
  for (const [command = '', ...commandArgs] of plan.steps) {
    const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
    if (result.error !== undefined) {
      console.error(`${command} calistirilamadi: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

// Yalnizca dogrudan calistirildiginda (testler import eder, calistirmaz).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
