import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Gelistirme sunucusu gateway'e PROXY ile baglanir: tarayici yalnizca kendi
 * kaynagiyla (localhost:5173) konusur, gateway'de CORS acmak gerekmez ve
 * uretimdeki "ayni kaynak arkasinda BFF" duzeni yerelde de aynen korunur.
 */

/** Roadmap port haritasi: web 5173, gateway 8080. */
const DEV_SERVER_PORT = 5173;
const DEFAULT_GATEWAY_URL = 'http://localhost:8080';

/** Gateway'e yonlenen yol onekleri. */
const PROXIED_PATHS = ['/v1', '/healthz'] as const;

/**
 * Demo persona secici (T8.5): gelistirmede acik (VITE_DEMO_PERSONAS=false kapatir),
 * production derlemesinde (`vite build`) HER ZAMAN kapali; ortam degiskeni onu
 * acamaz. Kapaliyken secici ve persona verisi pakete girmez; CI paketi tarar
 * (scripts/check-web-bundle.mjs).
 */
function demoPersonasEnabled(mode: string, env: Record<string, string>): boolean {
  return mode !== 'production' && env['VITE_DEMO_PERSONAS'] !== 'false';
}

export default defineConfig(({ mode }) => {
  // VITE_ onekli olmayan degiskenler istemci paketine GIRMEZ; yalnizca burada okunur.
  const env = loadEnv(mode, process.cwd(), '');
  const gatewayUrl = env['GATEWAY_URL'] ?? DEFAULT_GATEWAY_URL;

  return {
    plugins: [react()],
    define: {
      __DEMO_PERSONAS__: JSON.stringify(demoPersonasEnabled(mode, env)),
      // Kodsuz sifre yenileme (T11.9): production derlemesinde HER ZAMAN kapali.
      __DEMO_PASSWORD_RESET__: JSON.stringify(mode !== 'production'),
      // Odeme Yontemlerim (T11.17, K1 (a)): kart uclari production'da kapali (404);
      // production derlemesinde menu maddesi ve iki rota HIC yok.
      __CARD_VAULT__: JSON.stringify(mode !== 'production'),
    },
    resolve: {
      // @getir/core'daki node:crypto importu icin tarayici karsiligi (dosyadaki aciklama).
      alias: {
        'node:crypto': fileURLToPath(new URL('src/shared/shims/node-crypto.ts', import.meta.url)),
      },
    },
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
      proxy: Object.fromEntries(
        PROXIED_PATHS.map((path) => [path, { target: gatewayUrl, changeOrigin: true }]),
      ),
    },
  };
});
