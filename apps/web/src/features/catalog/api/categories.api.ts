/** GET /v1/categories - platform geneli kategori listesi. */

import { categoryListSchema } from '@getir/contracts';
import type { CategoryList } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

export function fetchCategories(client: HttpClient, signal?: AbortSignal): Promise<CategoryList> {
  return client.request('/v1/categories', { schema: categoryListSchema, signal });
}
