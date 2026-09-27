/**
 * gRPC hatasindaki x-app-error metadata'sini okur. Metadata dis veridir:
 * `JSON.parse(...) as` ile zorlanmaz, semadan gecirilir (proje kurali, ADR-10).
 *
 * Ayni yardimci order ve payment testlerinde de var; uc kopya D5'te
 * service-kit'ten disa verilen tek yardimciya tasinacak.
 */

import { ERROR_METADATA_KEY } from '@getir/service-kit';
import type { ServiceError } from '@grpc/grpc-js';
import { z } from 'zod';

const appErrorMetadataSchema = z.object({
  code: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
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
