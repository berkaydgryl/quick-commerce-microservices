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

export default defineConfig(({ mode }) => {
  // VITE_ onekli olmayan degiskenler istemci paketine GIRMEZ; yalnizca burada okunur.
  const env = loadEnv(mode, process.cwd(), '');
  const gatewayUrl = env['GATEWAY_URL'] ?? DEFAULT_GATEWAY_URL;

  return {
    plugins: [react()],
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
