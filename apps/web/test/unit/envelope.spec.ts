import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { unwrapEnvelope } from '../../src/shared/api/envelope';

const itemSchema = z.object({ id: z.string() });

describe('unwrapEnvelope', () => {
  it('basari zarfindan data doner', () => {
    const data = unwrapEnvelope(itemSchema, { success: true, data: { id: 'a' } });
    expect(data).toEqual({ id: 'a' });
  });

  it('hata zarfini kod, mesaj, details ve requestId ile AppError yapar', () => {
    const payload = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Bulunamadi', details: { id: 'x' }, requestId: 'req_1' },
    };

    const error = captureError(() => unwrapEnvelope(itemSchema, payload));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      message: 'Bulunamadi',
      details: { id: 'x' },
      requestId: 'req_1',
    });
  });

  it('data semaya uymuyorsa INTERNAL firlatir (sozlesme kirik)', () => {
    const error = captureError(() =>
      unwrapEnvelope(itemSchema, { success: true, data: { id: 1 } }),
    );
    expect(error).toMatchObject({ code: ERROR_CODES.INTERNAL });
  });

  it('zarf olmayan govdede INTERNAL firlatir', () => {
    expect(captureError(() => unwrapEnvelope(itemSchema, null))).toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
    expect(captureError(() => unwrapEnvelope(itemSchema, { id: 'a' }))).toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });

  it('bilinmeyen hata kodu sozlesme disidir: INTERNAL', () => {
    const payload = {
      success: false,
      error: { code: 'TEAPOT', message: 'x', requestId: 'req_1' },
    };
    expect(captureError(() => unwrapEnvelope(itemSchema, payload))).toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('hata bekleniyordu');
}
