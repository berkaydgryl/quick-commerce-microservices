/**
 * Node servis imaji denetimi (D12): calisma klasoru izin listesi, dist, imaj ayari
 * ve acilis beklemesi. Docker gerekmez; acilis sahte bir docker ile denenir.
 */

import { describe, expect, it } from 'vitest';

import {
  appEntryProblems,
  bootProblem,
  configProblems,
  declaredEntries,
  distProblems,
  healthcheckCommand,
  parseImageConfig,
} from '../check-node-image.mjs';

const HEALTH = ['node', 'dist/healthcheck.js'];

describe('appEntryProblems', () => {
  it('yalnizca dist, node_modules ve package.json (ve README) varsa sorun yok', () => {
    expect(appEntryProblems(['dist', 'node_modules', 'package.json'])).toEqual([]);
    expect(appEntryProblems(['README.md', 'dist', 'node_modules', 'package.json'])).toEqual([]);
  });

  it('D12 oncesi imaj: src, tsconfig ve .turbo kaynak/derleme artigi diye raporlanir', () => {
    const before = [
      '.turbo',
      'README.md',
      'dist',
      'node_modules',
      'package.json',
      'src',
      'tsconfig.build.json',
      'tsconfig.json',
    ];
    expect(appEntryProblems(before, ['dist'])).toEqual([
      'kaynak ya da derleme artigi: .turbo, src, tsconfig.build.json, tsconfig.json',
    ]);
  });

  it('izin listesidir: bilinmeyen yeni bir artik da yakalanir', () => {
    expect(appEntryProblems(['dist', 'node_modules', 'package.json', 'vitest.config.ts'])).toEqual([
      'calisma icin gereksiz: vitest.config.ts ' +
        '(calisma aninda gerekiyorsa package.json "files" alanina yazilir)',
    ]);
  });

  it('"files" alaninda yazilan calisma klasoru (orn. lua/) izinlidir', () => {
    const entries = ['dist', 'lua', 'node_modules', 'package.json'];
    expect(appEntryProblems(entries, ['dist', 'lua'])).toEqual([]);
  });

  it('kaynak "files" alanina yazilsa bile yasaktir', () => {
    const entries = ['dist', 'node_modules', 'package.json', 'src', 'test'];
    expect(appEntryProblems(entries, ['dist', 'src', 'test'])).toEqual([
      'kaynak ya da derleme artigi: src, test',
    ]);
  });

  it('eksik zorunlu giris raporlanir', () => {
    expect(appEntryProblems(['dist', 'package.json'])).toEqual(['eksik: node_modules']);
  });
});

describe('declaredEntries', () => {
  it.each([
    [['dist'], ['dist']],
    [
      ['dist', 'lua/*.lua', './proto'],
      ['dist', 'lua', 'proto'],
    ],
    [['dist/**/*.js', 'dist'], ['dist']],
    [['dist', '!dist/**/*.map', '*.lua'], ['dist']],
    [undefined, []],
    [['dist', 5], ['dist']],
  ])('%j -> %j', (files, entries) => {
    expect(declaredEntries(files)).toEqual(entries);
  });
});

describe('distProblems', () => {
  it('giris noktalari var, tip bildirimi yoksa sorun yok', () => {
    expect(
      distProblems(['main.js', 'main.js.map', 'healthcheck.js', 'config/risk.rules.json']),
    ).toEqual([]);
  });

  it('eksik giris noktasi raporlanir', () => {
    expect(distProblems(['main.js'])).toEqual(['eksik giris noktasi: healthcheck.js']);
  });

  it('.d.ts ve .d.ts.map sayilir, ilk ornek yazilir', () => {
    expect(distProblems(['main.js', 'healthcheck.js', 'main.d.ts', 'config/env.d.ts.map'])).toEqual(
      ['2 tip bildirimi (.d.ts) var, uygulamada uretilmez (ornek: config/env.d.ts.map)'],
    );
  });
});

describe('healthcheckCommand', () => {
  it.each([
    [
      ['CMD', 'node', 'dist/healthcheck.js'],
      ['node', 'dist/healthcheck.js'],
    ],
    [
      ['CMD-SHELL', 'node dist/healthcheck.js'],
      ['sh', '-c', 'node dist/healthcheck.js'],
    ],
    [['NONE'], null],
    [['CMD'], null],
    [null, null],
  ])('%j -> %j', (test, command) => {
    expect(healthcheckCommand(test)).toEqual(command);
  });
});

describe('configProblems', () => {
  const healthy = { workDir: '/app', healthcheck: ['CMD', ...HEALTH] };

  it.each(['node', '1000', '1000:1000'])('USER %s root degil', (user) => {
    expect(configProblems({ ...healthy, user })).toEqual([]);
  });

  it.each(['', 'root', '0', '0:0', 'root:root'])('USER "%s" root sayilir', (user) => {
    expect(configProblems({ ...healthy, user })).toEqual([
      `konteyner root ile calisiyor (USER "${user}"), USER node olmali`,
    ]);
  });

  it('WORKDIR ve HEALTHCHECK yoksa ikisi de raporlanir', () => {
    expect(configProblems({ user: 'node', workDir: '', healthcheck: ['NONE'] })).toEqual([
      'WORKDIR tanimli degil',
      'HEALTHCHECK tanimli degil',
    ]);
  });
});

describe('parseImageConfig', () => {
  it('docker inspect ciktisini okur', () => {
    const config = {
      User: 'node',
      WorkingDir: '/app',
      Healthcheck: { Test: ['CMD', ...HEALTH], Interval: 15_000_000_000 },
      Cmd: ['node', 'dist/main.js'],
    };
    expect(parseImageConfig(config)).toEqual({
      user: 'node',
      workDir: '/app',
      healthcheck: ['CMD', ...HEALTH],
    });
  });

  it('beklenmeyen alanlar bos deger olur (denetim sorun olarak raporlar)', () => {
    expect(parseImageConfig(null)).toEqual({ user: '', workDir: '', healthcheck: null });
    expect(parseImageConfig({ User: 5, Healthcheck: { Test: ['CMD', 1] } })).toEqual({
      user: '',
      workDir: '',
      healthcheck: null,
    });
  });
});

/**
 * Sahte docker: her alt komut (run, exec, inspect, logs, rm) icin bir cevap.
 * @param {Record<string, (args: readonly string[]) => { stdout: string, stderr: string }>} handlers
 */
function fakeDocker(handlers) {
  /** @type {string[]} */
  const calls = [];
  /** @param {readonly string[]} args */
  const docker = (args) => {
    calls.push(args.join(' '));
    const handler = handlers[args[0] ?? ''];
    if (handler === undefined) {
      return Promise.reject(new Error(`beklenmeyen docker komutu: ${args.join(' ')}`));
    }
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return { docker, calls };
}

const output = (stdout, stderr = '') => ({ stdout, stderr });
const fail = () => {
  throw new Error('exit 1');
};

/** Her cagrida `step` ms ilerleyen saat; bekleme yapmaz. */
function fakeClock(step) {
  let time = 0;
  return { now: () => (time += step), sleep: () => Promise.resolve() };
}

describe('bootProblem', () => {
  it('saglik komutu gecene kadar bekler, sonra konteyneri siler', async () => {
    let attempts = 0;
    const { docker, calls } = fakeDocker({
      run: () => output('c0ffee\n'),
      exec: () => {
        attempts += 1;
        if (attempts < 3) fail();
        return output('');
      },
      inspect: () => output('true\n'),
      rm: () => output('c0ffee\n'),
    });

    const problem = await bootProblem('getir/risk-service', HEALTH, {
      docker,
      ...fakeClock(1),
    });

    expect(problem).toBeNull();
    expect(attempts).toBe(3);
    expect(calls[0]).toBe(
      'run --detach --pull=never --network=none --env MOCK=true getir/risk-service',
    );
    expect(calls).toContain('exec c0ffee node dist/healthcheck.js');
    expect(calls.at(-1)).toBe('rm --force c0ffee');
  });

  it('servis acilista durursa son gunluk satirlariyla raporlanir', async () => {
    const { docker, calls } = fakeDocker({
      run: () => output('dead\n'),
      exec: fail,
      inspect: () => output('false\n'),
      logs: () => output('', "Error: Cannot find module './risk.rules.json'\n"),
      rm: () => output('dead\n'),
    });

    const problem = await bootProblem('getir/risk-service', HEALTH, { docker, ...fakeClock(1) });

    expect(problem).toContain('servis acilista durdu');
    expect(problem).toContain("Cannot find module './risk.rules.json'");
    expect(calls.at(-1)).toBe('rm --force dead');
  });

  it('sure dolarsa zaman asimi raporlanir ve konteyner yine silinir', async () => {
    const { docker, calls } = fakeDocker({
      run: () => output('slow\n'),
      exec: fail,
      inspect: () => output('true\n'),
      logs: () => output('{"msg":"baslatiliyor"}\n'),
      rm: () => output('slow\n'),
    });

    const problem = await bootProblem('getir/risk-service', HEALTH, {
      docker,
      timeoutMs: 30_000,
      ...fakeClock(10_000),
    });

    expect(problem).toContain('saglik komutu 30 sn icinde gecmedi');
    expect(problem).toContain('baslatiliyor');
    expect(calls.at(-1)).toBe('rm --force slow');
  });
});
