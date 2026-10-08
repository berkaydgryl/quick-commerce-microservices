import { APP_LOADER_MIN_VISIBLE_MS, APP_LOADER_SHOW_AFTER_MS } from '../../config/constants';

/** Saat ve zamanlayici (testte sahte saat). */
export interface LoaderClock {
  readonly now: () => number;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
}

export interface LoaderGate {
  /** Bekleyis basladi (true) ya da bitti (false). */
  readonly busy: (busy: boolean) => void;
  readonly dispose: () => void;
}

/** Tekduze saat (performance.now): sistem saati geri/ileri alinsa da sure bozulmaz. */
const SYSTEM_CLOCK: LoaderClock = {
  now: () => globalThis.performance.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * Yukleniyor gostergesinin titreme korumasi (F18; PM S2 a; saf): bekleyis
 * showAfterMs'i asarsa gorunur; gorunduyse bekleyis bitse de en az
 * minVisibleMs kalir (bir an parlayip kaybolmaz). Hizli bekleyiste hic
 * gorunmez. Gorunur kalirken yeni bekleyis baslarsa gosterge kalir.
 */
export function createLoaderGate(
  onVisible: (visible: boolean) => void,
  timing = { showAfterMs: APP_LOADER_SHOW_AFTER_MS, minVisibleMs: APP_LOADER_MIN_VISIBLE_MS },
  clock: LoaderClock = SYSTEM_CLOCK,
): LoaderGate {
  let visible = false;
  let shownAt = 0;
  let timer: unknown;

  const clear = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const show = (next: boolean) => {
    timer = undefined;
    if (visible === next) return;
    visible = next;
    if (next) shownAt = clock.now();
    onVisible(next);
  };

  return {
    busy: (busy) => {
      clear();
      if (busy) {
        if (!visible) timer = clock.setTimeout(() => show(true), timing.showAfterMs);
        return;
      }
      if (!visible) return;
      const left = shownAt + timing.minVisibleMs - clock.now();
      if (left <= 0) show(false);
      else timer = clock.setTimeout(() => show(false), left);
    },
    dispose: clear,
  };
}
