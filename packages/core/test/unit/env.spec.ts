import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AppError,
  ERROR_CODES,
  commonEnvSchema,
  envBoolean,
  envInt,
  envString,
  isAppError,
  loadEnv,
  requireEnv,
} from '../../src/index.js';

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const CATALOG_PORT = 50_051;
const MONGO_URI = 'mongodb://localhost:27017/getir?directConnection=true';

const serviceEnvSchema = commonEnvSchema.extend({
  GRPC_PORT: envInt({ min: MIN_PORT, max: MAX_PORT }),
  MONGO_URI: z.string().min(1),
});

const validSource = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  MOCK: 'true',
  GRPC_PORT: String(CATALOG_PORT),
  MONGO_URI,
};

/** Hata mesajini test icinde okuyabilmek icin kucuk yardimci. */
function captureEnvError(source: Record<string, string | undefined>): AppError {
  try {
    loadEnv(serviceEnvSchema, source);
  } catch (error) {
    if (isAppError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('loadEnv hata firlatmaliydi');
}

describe('loadEnv', () => {
  it('gecerli kaynakta tipli nesne dondurur', () => {
    const env = loadEnv(serviceEnvSchema, validSource);

    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.MOCK).toBe(true);
    expect(env.GRPC_PORT).toBe(CATALOG_PORT);
    expect(env.MONGO_URI).toBe(MONGO_URI);
  });

  it('eksik degiskende AppError firlatir ve mesaj eksik alani icerir', () => {
    const { GRPC_PORT: _omitted, ...withoutPort } = validSource;
    const error = captureEnvError(withoutPort);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.message).toContain('GRPC_PORT');
    expect(error.message).toContain('Ortam degiskenleri gecersiz');
  });

  it('eksik alanlarin HEPSINI tek tek listeler', () => {
    const error = captureEnvError({});

    expect(error.message).toContain('GRPC_PORT');
    expect(error.message).toContain('MONGO_URI');
    // expect.arrayContaining() `any` dondurur; tipli lint kurallarini ihlal
    // etmemek icin detayi acikca daraltip dogrudan kontrol ediyoruz.
    const details = error.details as { issues: string[] };
    expect(details.issues).toHaveLength(2);
    expect(details.issues.some((issue) => issue.includes('GRPC_PORT'))).toBe(true);
    expect(details.issues.some((issue) => issue.includes('MONGO_URI'))).toBe(true);
  });

  it('gecersiz degerde alan adini ve sebebi bildirir', () => {
    const error = captureEnvError({ ...validSource, GRPC_PORT: 'abc' });

    expect(error.message).toContain('GRPC_PORT');
    expect(error.message).toContain('tam sayi bekleniyor');
  });

  it('aralik disindaki portu reddeder', () => {
    const error = captureEnvError({ ...validSource, GRPC_PORT: '0' });
    expect(error.message).toContain('GRPC_PORT');
    expect(error.message).toContain(`en az ${MIN_PORT}`);
  });

  it('bilinmeyen NODE_ENV degerini reddeder', () => {
    const error = captureEnvError({ ...validSource, NODE_ENV: 'staging' });
    expect(error.message).toContain('NODE_ENV');
  });
});

describe('commonEnvSchema', () => {
  it('bos kaynakta varsayilanlari uygular', () => {
    const env = loadEnv(commonEnvSchema, {});

    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.MOCK).toBe(false);
  });

  it('MOCK degerini farkli yazimlarla okur', () => {
    expect(loadEnv(commonEnvSchema, { MOCK: '1' }).MOCK).toBe(true);
    expect(loadEnv(commonEnvSchema, { MOCK: 'TRUE' }).MOCK).toBe(true);
    expect(loadEnv(commonEnvSchema, { MOCK: 'on' }).MOCK).toBe(true);
    expect(loadEnv(commonEnvSchema, { MOCK: '0' }).MOCK).toBe(false);
    expect(loadEnv(commonEnvSchema, { MOCK: 'no' }).MOCK).toBe(false);
  });

  it('anlamsiz MOCK degerini reddeder', () => {
    expect(() => loadEnv(commonEnvSchema, { MOCK: 'belki' })).toThrowError(/MOCK/);
  });
});

describe('envBoolean / envInt', () => {
  it('envBoolean varsayilani uygular', () => {
    const schema = z.object({ FLAG: envBoolean(true) });
    expect(loadEnv(schema, {}).FLAG).toBe(true);
    expect(loadEnv(schema, { FLAG: 'false' }).FLAG).toBe(false);
  });

  it('envInt varsayilani uygular ve float reddeder', () => {
    const schema = z.object({ TICK_MS: envInt({ defaultValue: 2_000 }) });
    expect(loadEnv(schema, {}).TICK_MS).toBe(2_000);
    expect(() => loadEnv(schema, { TICK_MS: '1.5' })).toThrowError(/TICK_MS/);
  });
});

describe('envString', () => {
  it('varsayilan verilirse tanimsiz ve BOS deger ayni sayilir', () => {
    // docker-compose'da "GRPC_HOST=" yazmak degiskeni bos string olarak gecirir;
    // zod'un .default() bunu tanimli kabul edip varsayilani uygulamazdi.
    const schema = z.object({ HOST: envString('0.0.0.0') });

    expect(loadEnv(schema, {}).HOST).toBe('0.0.0.0');
    expect(loadEnv(schema, { HOST: '   ' }).HOST).toBe('0.0.0.0');
    expect(loadEnv(schema, { HOST: ' 127.0.0.1 ' }).HOST).toBe('127.0.0.1');
  });

  it('varsayilan yoksa degisken zorunludur', () => {
    const schema = z.object({ MONGO_URI: envString() });

    expect(() => loadEnv(schema, {})).toThrowError(/MONGO_URI/);
    expect(() => loadEnv(schema, { MONGO_URI: '' })).toThrowError(/MONGO_URI/);
  });
});

describe('requireEnv', () => {
  it('degeri dondurur', () => {
    expect(requireEnv('MONGO_URI', { MONGO_URI })).toBe(MONGO_URI);
  });

  it('eksik veya bos degerde alan adini iceren hata firlatir', () => {
    expect(() => requireEnv('MONGO_URI', {})).toThrowError(/MONGO_URI/);
    expect(() => requireEnv('MONGO_URI', { MONGO_URI: '   ' })).toThrowError(/MONGO_URI/);
  });
});
