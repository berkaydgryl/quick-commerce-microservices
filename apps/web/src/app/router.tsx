import { createBrowserRouter } from 'react-router-dom';

import { HomePage } from '../pages/home/HomePage';
import { MarketPage } from '../pages/market/MarketPage';
import { NearbyMarketsPage } from '../pages/markets/NearbyMarketsPage';

/** Rota tablosu: rota basina bir sayfa kabugu (pages/). */
export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/markets', element: <NearbyMarketsPage /> },
  { path: '/markets/:marketId', element: <MarketPage /> },
]);
