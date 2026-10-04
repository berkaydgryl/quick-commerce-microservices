import { createBrowserRouter } from 'react-router-dom';

import { AUTH_ROUTES } from '../features/auth/routes';
import { FAVORITES_PATH } from '../features/favorites/routes';
import { AccountPage } from '../pages/account/AccountPage';
import { FavoritesPage } from '../pages/account/FavoritesPage';
import { ForgotPasswordPage } from '../pages/forgot-password/ForgotPasswordPage';
import { LoginPage } from '../pages/login/LoginPage';
import { MarketPage } from '../pages/market/MarketPage';
import { NearbyMarketsPage } from '../pages/markets/NearbyMarketsPage';
import { RegisterPage } from '../pages/register/RegisterPage';
import { RootPage } from '../pages/root/RootPage';

import { AppShell } from './AppShell';

/** Rota tablosu: rota basina bir sayfa kabugu (pages/); hepsi uygulama kabugunun icinde. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      // Oturumsuz: karsilama ekrani; oturumda: ana sayfa (T11.6).
      { path: AUTH_ROUTES.welcome, element: <RootPage /> },
      { path: '/markets', element: <NearbyMarketsPage /> },
      { path: '/markets/:marketId', element: <MarketPage /> },
      { path: AUTH_ROUTES.login, element: <LoginPage /> },
      { path: AUTH_ROUTES.register, element: <RegisterPage /> },
      // Kodsuz sifre yenileme (T11.9): yalnizca gelistirme paketinde; production'da adres yok.
      ...(__DEMO_PASSWORD_RESET__
        ? [{ path: AUTH_ROUTES.forgotPassword, element: <ForgotPasswordPage /> }]
        : []),
      { path: AUTH_ROUTES.account, element: <AccountPage /> },
      { path: FAVORITES_PATH, element: <FavoritesPage /> },
    ],
  },
]);
