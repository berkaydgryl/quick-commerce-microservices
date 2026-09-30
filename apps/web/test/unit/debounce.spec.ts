/** Debounce zamanlayicisi (T9.5): hizli ardisik isteklerden yalnizca sonuncusu calisir. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncer } from '../../src/shared/services/debounce';

const DELAY = 300;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDebouncer', () => {
  it('ardisik islerden yalnizca SONUNCUSU, son istekten delay sonra calisir', () => {
    const debouncer = createDebouncer(DELAY);
    const ran: string[] = [];

    debouncer.schedule(() => ran.push('c'));
    vi.advanceTimersByTime(DELAY - 1);
    debouncer.schedule(() => ran.push('ci'));
    vi.advanceTimersByTime(DELAY - 1);
    debouncer.schedule(() => ran.push('cik'));
    vi.advanceTimersByTime(DELAY - 1);
    expect(ran).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['cik']);
  });

  it('cancel bekleyen isi atar', () => {
    const debouncer = createDebouncer(DELAY);
    const task = vi.fn();

    debouncer.schedule(task);
    debouncer.cancel();
    vi.advanceTimersByTime(DELAY * 2);

    expect(task).not.toHaveBeenCalled();
  });

  it('is calistiktan sonra yeni is yeniden beklenir', () => {
    const debouncer = createDebouncer(DELAY);
    const task = vi.fn();

    debouncer.schedule(task);
    vi.advanceTimersByTime(DELAY);
    debouncer.schedule(task);
    vi.advanceTimersByTime(DELAY);

    expect(task).toHaveBeenCalledTimes(2);
  });
});
