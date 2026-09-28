import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { useCartStorageSync } from '../features/cart/hooks/useCartStorageSync';

import { createQueryClient } from './query-client';
import { router } from './router';

const queryClient = createQueryClient();

export function App() {
  // Sepet baska sekmede degisirse bu sekmeye yansir (T7.6).
  useCartStorageSync();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
