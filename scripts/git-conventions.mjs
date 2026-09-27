#!/usr/bin/env node
/**
 * Git kurallari (proje-kurallari.mdc "Git" bolumu) - CI'in "Git kurallari" isi calistirir (D13).
 *
 *   node scripts/git-conventions.mjs branch <dal-adi>
 *   node scripts/git-conventions.mjs commits <taban-sha> <uc-sha>
 *
 * Commit basligi: `<tip>(<alan>): <aciklama> (<gorev kimligi>)`, ornek
 *   feat(order): sunucu tarafi fiyat dogrulamasi (T7.2)
 * Dal adi: `<tip>/<alan>-<kisa-aciklama>`, ornek `refactor/order-test-bolme`.
 *
 * ALAN LISTESI ELLE TUTULMAZ: kural dosyasindaki "Alan etiketleri" satirindan
 * okunur. Kurali degistiren betigi de degistirmis olur; iki yer ayrisamaz.
 * Merge commit'leri kontrol edilmez (GitHub'in "Merge pull request #N" basligi).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Conventional commits tipleri (commit basligi ve dal oneki icin ayni liste). */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'ci',
  'perf',
  'build',
];

/** Gorev kimligi: roadmap gorevi (T7.2) ya da denetim duzeltmesi (D13). */
const TASK_ID = String.raw`(?:T\d+\.\d+|D\d+)`;

const RULES_FILE = fileURLToPath(new URL('../.cursor/rules/proje-kurallari.mdc', import.meta.url));
const AREAS_LINE = /^- Alan etiketleri: (.+?)\.?$/m;

const EXAMPLE_SUBJECT = 'feat(order): sunucu tarafi fiyat dogrulamasi (T7.2)';
const EXAMPLE_BRANCH = 'feat/order-fiyat-dogrulama';

/**
 * Kural dosyasinin metninden izinli alan listesini cikarir.
 * @param {string} rulesText
 * @returns {string[]}
 */
export function parseAreas(rulesText) {
  const match = AREAS_LINE.exec(rulesText);
  if (match === null || match[1] === undefined) {
    throw new Error('Kural dosyasinda "- Alan etiketleri: ..." satiri bulunamadi');
  }
  return match[1]
    .split(',')
    .map((area) => area.trim())
    .filter((area) => area !== '');
}

/** @returns {string[]} */
export function loadAreas(path = RULES_FILE) {
  return parseAreas(readFileSync(path, 'utf8'));
}

/**
 * Commit basligindaki sorun; basligi uygunsa null.
 * @param {string} subject
 * @param {readonly string[]} areas
 * @returns {string | null}
 */
export function commitSubjectProblem(subject, areas) {
  const header = /^([a-z]+)\(([a-z-]+)\): (.+)$/.exec(subject);
  if (header === null) {
    return `"tip(alan): aciklama (gorev)" biciminde degil; ornek: ${EXAMPLE_SUBJECT}`;
  }
  const [, type = '', area = '', rest = ''] = header;
  if (!COMMIT_TYPES.includes(type)) {
    return `bilinmeyen tip "${type}"; izinliler: ${COMMIT_TYPES.join(', ')}`;
  }
  if (!areas.includes(area)) {
    return `izinli olmayan alan "${area}"; izinliler: ${areas.join(', ')}`;
  }
  if (!new RegExp(String.raw`^\S.* \(${TASK_ID}\)$`).test(rest)) {
    return 'sonunda gorev kimligi yok: "(T7.2)" ya da "(D13)" gibi, aciklamadan bir bosluk sonra';
  }
  return null;
}

/**
 * Dal adindaki sorun; ad uygunsa null.
 * @param {string} branch
 * @param {readonly string[]} areas
 * @returns {string | null}
 */
export function branchNameProblem(branch, areas) {
  const match = /^([a-z]+)\/([a-z]+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(branch);
  if (match === null) {
    return `"tip/alan-kisa-aciklama" biciminde degil (kucuk harf, rakam, tire); ornek: ${EXAMPLE_BRANCH}`;
  }
  const [, type = '', area = ''] = match;
  if (!COMMIT_TYPES.includes(type)) {
    return `bilinmeyen tip "${type}"; izinliler: ${COMMIT_TYPES.join(', ')}`;
  }
  if (!areas.includes(area)) {
    return `izinli olmayan alan "${area}"; izinliler: ${areas.join(', ')}`;
  }
  return null;
}

/**
 * Aralikta (merge'ler haric) kurala uymayan commit'ler.
 * @param {string} base
 * @param {string} head
 * @param {readonly string[]} areas
 * @param {(base: string, head: string) => string} [log] - "kisa-sha<TAB>baslik" satirlari
 * @returns {{ sha: string, subject: string, problem: string }[]}
 */
export function rangeProblems(base, head, areas, log = gitLog) {
  return log(base, head)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha = '', ...subjectParts] = line.split('\t');
      const subject = subjectParts.join('\t');
      return { sha, subject, problem: commitSubjectProblem(subject, areas) };
    })
    .filter(
      /** @returns {entry is { sha: string, subject: string, problem: string }} */
      (entry) => entry.problem !== null,
    );
}

/** @param {string} base @param {string} head */
function gitLog(base, head) {
  return execFileSync('git', ['log', '--no-merges', '--format=%h%x09%s', `${base}..${head}`], {
    encoding: 'utf8',
  });
}

function main(argv) {
  const [command, ...args] = argv;
  const areas = loadAreas();

  if (command === 'branch' && args.length === 1) {
    const [branch = ''] = args;
    const problem = branchNameProblem(branch, areas);
    if (problem !== null) {
      console.error(`✗ dal adi "${branch}": ${problem}`);
      return 1;
    }
    console.log(`✓ dal adi "${branch}" kurala uygun`);
    return 0;
  }

  if (command === 'commits' && args.length === 2) {
    const [base = '', head = ''] = args;
    const problems = rangeProblems(base, head, areas);
    for (const { sha, subject, problem } of problems) {
      console.error(`✗ ${sha} "${subject}": ${problem}`);
    }
    if (problems.length > 0) {
      console.error(
        `\n${problems.length} commit basligi kurala uymuyor. Duzeltmek icin: git rebase -i ${base} ` +
          'ile basliklari yeniden yazip dali zorla gonderin (yalnizca kendi dalinizda).',
      );
      return 1;
    }
    console.log('✓ tum commit basliklari kurala uygun');
    return 0;
  }

  console.error('kullanim: git-conventions.mjs branch <dal> | commits <taban-sha> <uc-sha>');
  return 2;
}

// Yalnizca dogrudan calistirildiginda (testler import eder, calistirmaz).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
