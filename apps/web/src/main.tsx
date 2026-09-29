import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './shared/styles/tokens.css';
import './shared/styles/global.css';

import { App } from './app/App';
import { restoreSession } from './shared/session/restore-session';
import { sessionRefresher } from './shared/session/session';
import { useSessionStore } from './shared/session/session-store';

// Oturum sessizce geri yuklenir (T8.5): bellekteki jeton sayfa yenilenince
// gider, cerezdeki yenileme jetonu onu geri getirir. Herkese acik sayfalar
// cevabi beklemeden cizilir; korumali sayfa ve baslik bekler.
void restoreSession({ refresher: sessionRefresher, session: useSessionStore.getState() });

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('index.html icinde #root bulunamadi');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
