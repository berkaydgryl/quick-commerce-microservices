import { createBrowserRouter } from 'react-router-dom';

import { HomePage } from '../pages/home/HomePage';

/** Rota tablosu: rota basina bir sayfa kabugu (pages/). */
export const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);
