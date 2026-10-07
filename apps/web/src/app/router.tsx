import { createBrowserRouter } from 'react-router-dom';

import { ADDRESSES_PATH } from '../features/address/routes';
import { AUTH_ROUTES } from '../features/auth/routes';
import { ADD_CARD_PATH, PAYMENT_METHODS_PATH } from '../features/cards/routes';
import { CART_PATH } from '../features/cart/routes';
import { FAVORITES_PATH } from '../features/favorites/routes';
import { ORDER_DETAIL_ROUTE, ORDERS_PATH } from '../features/orders/routes';
import { AccountPage } from '../pages/account/AccountPage';
import { AddCardPage } from '../pages/account/AddCardPage';
import { AddressesPage } from '../pages/account/AddressesPage';
import { FavoritesPage } from '../pages/account/FavoritesPage';
import { OrderDetailPage } from '../pages/account/OrderDetailPage';
import { OrdersPage } from '../pages/account/OrdersPage';
import { PaymentMethodsPage } from '../pages/account/PaymentMethodsPage';
import { CartPage } from '../pages/cart/CartPage';
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
      // Sepet sayfasi (T16.3): oturum ister, sayfa kendisi korur.
      { path: CART_PATH, element: <CartPage /> },
      { path: AUTH_ROUTES.login, element: <LoginPage /> },
      { path: AUTH_ROUTES.register, element: <RegisterPage /> },
      // Kodsuz sifre yenileme (T11.9): yalnizca gelistirme paketinde; production'da adres yok.
      ...(__DEMO_PASSWORD_RESET__
        ? [{ path: AUTH_ROUTES.forgotPassword, element: <ForgotPasswordPage /> }]
        : []),
      { path: AUTH_ROUTES.account, element: <AccountPage /> },
      { path: ADDRESSES_PATH, element: <AddressesPage /> },
      { path: FAVORITES_PATH, element: <FavoritesPage /> },
      { path: ORDERS_PATH, element: <OrdersPage /> },
      { path: ORDER_DETAIL_ROUTE, element: <OrderDetailPage /> },
      // Odeme Yontemlerim (T11.17): yalnizca gelistirme paketinde (__CARD_VAULT__, K1 (a)).
      ...(__CARD_VAULT__
        ? [
            { path: PAYMENT_METHODS_PATH, element: <PaymentMethodsPage /> },
            { path: ADD_CARD_PATH, element: <AddCardPage /> },
          ]
        : []),
    ],
  },
]);
