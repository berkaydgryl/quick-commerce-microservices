/**
 * gRPC hatasindaki x-app-error metadata'sini okur. Metadata dis veridir:
 * `as` ile zorlanmaz, semadan gecirilir (proje kurali, ADR-10).
 */

import { ERROR_METADATA_KEY } from '@getir/service-kit';
import type { ServiceError } from '@grpc/grpc-js';
import { z } from 'zod';

const appErrorMetadataSchema = z.object({
  code: z.string(),
  details: z.unknown().optional(),
});

export type AppErrorMetadata = z.infer<typeof appErrorMetadataSchema>;

export function appErrorOf(error: ServiceError | undefined): AppErrorMetadata | undefined {
  const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const parsed = appErrorMetadataSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
}
