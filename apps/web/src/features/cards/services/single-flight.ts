/**
 * Ayni anda tek calisma (T17.1; F5 ek sart 3): is surerken gelen ikinci
 * cagri BIRAKILIR (beklemez, ikinci istek gitmez). Kart formunda Enter'a iki
 * kez basmak ya da dugme pasiflesmeden gelen ikinci tik ikinci POST'u
 * gondermez; is bitince (basari ya da hata) yeniden calisir.
 */
export function createSingleFlight(): (task: () => Promise<void>) => Promise<void> {
  let running = false;
  return async (task) => {
    if (running) {
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  };
}
