import { ERROR_CODES } from '@getir/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  apiErrorResponseSchema,
  apiFail,
  apiOk,
  apiResponseSchema,
  apiSuccessResponseSchema,
  type ApiSuccessResponse,
} from '../../src/index.js';

const REQUEST_ID = 'req_0123456789abcdef';

describe('basari kolu', () => {
  it('data ve meta tasir', () => {
    const schema = apiSuccessResponseSchema(z.string());

    expect(schema.parse({ success: true, data: 'merhaba' })).toEqual({
      success: true,
      data: 'merhaba',
    });
  });

  it('apiOk meta verilmediginde alani hic koymaz', () => {
    const result = apiOk('merhaba');

    // exactOptionalPropertyTypes acik: "meta: undefined" ile "meta yok" ayni degildir.
    expect(Object.hasOwn(result, 'meta')).toBe(false);
  });

  it('apiOk meta verildiginde tasir', () => {
    expect(apiOk('merhaba', { requestId: REQUEST_ID })).toEqual({
      success: true,
      data: 'merhaba',
      meta: { requestId: REQUEST_ID },
    });
  });

  /**
   * Jenerik zarf tek bir semadan turetilemedigi icin ApiSuccessResponse tipi
   * elle yazildi. Bu kontrol, tipin sema fabrikasinin urettigi sekille ayni
   * kaldigini DERLEME zamaninda dogrular; ikisi ayrisirsa bu dosya derlenmez.
   */
  it('elle yazilan tip, semanin urettigi tiple ayni', () => {
    type Inferred = z.infer<ReturnType<typeof apiSuccessResponseSchema<z.ZodString>>>;

    expectTypeOf<Inferred>().toEqualTypeOf<ApiSuccessResponse<string>>();
  });
});

describe('hata kolu', () => {
  it('hata bilgisi error nesnesinde GRUPLUDUR, kokte message yoktur', () => {
    const body = {
      success: false,
      error: {
        code: ERROR_CODES.STOCK_INSUFFICIENT,
        message: 'Bu üründen yeterli stok kalmadı.',
        requestId: REQUEST_ID,
      },
    };

    const parsed = apiErrorResponseSchema.parse(body);

    expect(parsed.error.message).toBe('Bu üründen yeterli stok kalmadı.');
    expect(Object.hasOwn(parsed, 'message')).toBe(false);
  });

  it('details null olabilir', () => {
    const parsed = apiErrorResponseSchema.parse({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL,
        message: 'Beklenmeyen bir sorun oldu.',
        details: null,
        requestId: REQUEST_ID,
      },
    });

    expect(parsed.error.details).toBeNull();
  });

  it('sozlukte olmayan kodu reddeder', () => {
    const result = apiErrorResponseSchema.safeParse({
      success: false,
      error: { code: 'KEYFI_KOD', message: 'x', requestId: REQUEST_ID },
    });

    expect(result.success).toBe(false);
  });

  it('apiFail zarfi kurar', () => {
    const error = {
      code: ERROR_CODES.NOT_FOUND,
      message: 'Aradığın kaydı bulamadık.',
      requestId: REQUEST_ID,
    };

    expect(apiFail(error)).toEqual({ success: false, error });
  });
});

describe('tam zarf', () => {
  const schema = apiResponseSchema(z.object({ id: z.string() }));

  it('success alanina gore ayirir', () => {
    const ok = schema.parse({ success: true, data: { id: 'a' } });
    const fail = schema.parse({
      success: false,
      error: { code: ERROR_CODES.FORBIDDEN, message: 'yok', requestId: REQUEST_ID },
    });

    expect(ok.success).toBe(true);
    expect(fail.success).toBe(false);
  });

  it('basarili kolda hatali data reddedilir', () => {
    expect(schema.safeParse({ success: true, data: { id: 42 } }).success).toBe(false);
  });
});
