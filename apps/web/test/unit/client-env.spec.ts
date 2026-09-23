import { describe, expect, it } from 'vitest';

import { parseClientEnv } from '../../src/shared/config/env';

describe('parseClientEnv', () => {
  it('degisken yoksa ayni kaynak (bos kok) kullanir', () => {
    expect(parseClientEnv({}).apiBaseUrl).toBe('');
  });

  it('mutlak adresin sonundaki egik cizgiyi atar', () => {
    expect(parseClientEnv({ VITE_API_BASE_URL: 'https://api.test/' }).apiBaseUrl).toBe(
      'https://api.test',
    );
  });

  it('gecersiz adreste acilisi durdurur', () => {
    expect(() => parseClientEnv({ VITE_API_BASE_URL: 'api.test' })).toThrow(/VITE_API_BASE_URL/);
  });
});
