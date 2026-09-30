/**
 * Son isi bekleten zamanlayici (debounce): her schedule bekleyen isi iptal
 * eder; is ancak delayMs boyunca yeni schedule gelmezse calisir. cancel
 * bekleyeni atar.
 *
 * React'e bagli degil: bilesen onu bir kez kurar (useState) ve kapanista cancel
 * eder. Boylece davranisi sahte saatle birim testinde sinanir.
 */

export interface Debouncer {
  schedule(task: () => void): void;
  cancel(): void;
}

export function createDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    schedule(task) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        task();
      }, delayMs);
    },
    cancel,
  };
}
