import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { useAddressStorageSync } from '../features/address/hooks/useAddressStorageSync';
import { useCartStorageSync } from '../features/cart/hooks/useCartStorageSync';

import { createQueryClient } from './query-client';
import { router } from './router';

const queryClient = createQueryClient();

export function App() {
  // Sepet ve secili teslimat adresi baska sekmede degisirse bu sekmeye yansir (T7.6, T9.5).
  useCartStorageSync();
  useAddressStorageSync();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
