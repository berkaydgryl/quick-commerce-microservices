/**
 * Tek tuketici grubunun Redis Streams komutlari (T7.4). KARAR VERMEZ: hangi
 * kaydin onaylanacagina dispatch.ts karar verir, dongu group-worker.ts'tedir.
 * Redis cevaplari dis veridir: Zod'dan gecer (ADR-10), `as` ile zorlanmaz.
 *
 * Cevap bicimleri Redis 7.4 + ioredis 6 (RESP3, varsayilan "legacy" esleme)
 * ile olculdu: RESP2 ile ayni sekil. Akistan silinmis bekleyen kaydi XCLAIM
 * dondurmez ve bekleyenler listesinden de siler (Redis 7+).
 */

import { AppError } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { z } from 'zod';

import { toDeadLetterFields } from './dead-letter.js';
import type { DeadLetter } from './dead-letter.js';
import { GROUP_START } from './delivery-settings.js';
import type { GroupStart } from './delivery-settings.js';
import type { StreamEntry } from './dispatch.js';

/** XGROUP CREATE baslangic kimligi: "0" akisin basi, "$" son kayittan sonrasi. */
const START_ID: Readonly<Record<GroupStart, string>> = {
  [GROUP_START.BEGINNING]: '0',
  [GROUP_START.LATEST]: '$',
};

const entrySchema = z.tuple([z.string(), z.array(z.string()).nullable()]);
/** XREADGROUP: [[akis, [[kimlik, alanlar], ...]]] ya da yeni kayit yoksa null. */
const readReplySchema = z.array(z.tuple([z.string(), z.array(entrySchema)])).nullable();
/** XPENDING (genis bicim): [[kimlik, tuketici, bosta gecen ms, teslim sayisi], ...]. */
const pendingReplySchema = z.array(z.tuple([z.string(), z.string(), z.number(), z.number()]));
const claimReplySchema = z.array(entrySchema);
/** XINFO GROUPS: grup basina duz alan listesi [ad, deger, ad, deger, ...]. */
const groupsInfoReplySchema = z.array(z.array(z.union([z.string(), z.number(), z.null()])));
/** Bir grubun kullanilan alanlari; lag hesaplanamazsa (akistan silme sonrasi) nil gelir. */
const groupInfoSchema = z.object({
  name: z.string(),
  pending: z.number().int().nonnegative(),
  lag: z.number().int().nonnegative().nullable().optional(),
});

/** Grubun anlik durumu (T10.5 metrikleri). */
export interface GroupStats {
  /** Gruba HIC teslim edilmemis kayit; Redis hesaplayamazsa undefined. */
  readonly lag: number | undefined;
  /** Teslim edilmis ama onaylanmamis kayit (isleniyor ya da takildi). */
  readonly pending: number;
}

export interface PendingEntry {
  readonly id: string;
  /** Simdiye kadar kac kez teslim edildi. */
  readonly deliveries: number;
}

/** Olu olay kaydinin cagirandan gelen kismi; kaynak, grup ve tuketiciyi bu sinif ekler. */
export type DeadLetterDetails = Omit<DeadLetter, 'sourceId' | 'group' | 'consumer'>;

/** Grup dongusunun gordugu yuzey (testte sahtesi takilir). */
export interface StreamGroup {
  /** Grubu kurar; zaten varsa dokunmaz (konumu korunur). */
  ensure(start: GroupStart): Promise<void>;
  /** Sahibi kim olursa olsun en az minIdleMs'dir onaylanmamis kayitlar, eskisi once. */
  stalePending(minIdleMs: number, count: number): Promise<PendingEntry[]>;
  /** Kaydi bu tuketiciye alir; baskasi az once aldiysa ya da kayit silindiyse undefined. */
  claim(id: string, minIdleMs: number): Promise<StreamEntry | undefined>;
  /** Grubun hic teslim edilmemis kayitlari; blockMs boyunca yeni kayit beklenir. */
  readNew(count: number, blockMs: number): Promise<StreamEntry[]>;
  ack(ids: readonly string[]): Promise<void>;
  /** Olu olaylar akisina yazar, SONRA kaynagi onaylar (arada cokulurse kayit tekrar gelir). */
  deadLetter(entry: StreamEntry, details: DeadLetterDetails): Promise<void>;
  /** Bekleyeni kalmadiysa tuketiciyi gruptan siler; kaldiysa dokunmaz (kayit kaybolmasin). */
  release(): Promise<boolean>;
  /** Grubun gecikmesi ve bekleyen sayisi (XINFO GROUPS); grup yoksa undefined. */
  stats(): Promise<GroupStats | undefined>;
}

export interface StreamGroupSettings {
  readonly streamKey: string;
  readonly deadLetterKey: string;
  readonly deadLetterMaxLength: number;
  readonly group: string;
  readonly consumer: string;
}

export class RedisStreamGroup implements StreamGroup {
  constructor(
    private readonly redis: RedisConnection['redis'],
    private readonly settings: StreamGroupSettings,
  ) {}

  async ensure(start: GroupStart): Promise<void> {
    const { streamKey, group } = this.settings;
    try {
      // MKSTREAM: akis henuz yoksa (ilk olaydan once) bos olarak kurulur.
      await this.redis.xgroup('CREATE', streamKey, group, START_ID[start], 'MKSTREAM');
    } catch (error: unknown) {
      if (!hasReplyPrefix(error, 'BUSYGROUP')) {
        throw error;
      }
    }
  }

  async stalePending(minIdleMs: number, count: number): Promise<PendingEntry[]> {
    const { streamKey, group } = this.settings;
    const reply = await this.redis.xpending(streamKey, group, 'IDLE', minIdleMs, '-', '+', count);
    return parseReply(pendingReplySchema, reply, 'XPENDING').map(([id, , , deliveries]) => ({
      id,
      deliveries,
    }));
  }

  async claim(id: string, minIdleMs: number): Promise<StreamEntry | undefined> {
    const { streamKey, group, consumer } = this.settings;
    // minIdleMs yeniden verilir: baska tuketici kaydi az once aldiysa XCLAIM bos doner.
    const reply = await this.redis.xclaim(streamKey, group, consumer, minIdleMs, id);
    const [entry] = parseReply(claimReplySchema, reply, 'XCLAIM');
    return entry === undefined ? undefined : { id: entry[0], fields: entry[1] };
  }

  async readNew(count: number, blockMs: number): Promise<StreamEntry[]> {
    const { streamKey, group, consumer } = this.settings;
    const reply = await this.redis.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      count,
      'BLOCK',
      blockMs,
      'STREAMS',
      streamKey,
      '>',
    );
    const streams = parseReply(readReplySchema, reply, 'XREADGROUP') ?? [];
    return streams.flatMap(([, entries]) => entries.map(([id, fields]) => ({ id, fields })));
  }

  async ack(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.redis.xack(this.settings.streamKey, this.settings.group, ...ids);
  }

  async deadLetter(entry: StreamEntry, details: DeadLetterDetails): Promise<void> {
    const { streamKey, deadLetterKey, deadLetterMaxLength, group, consumer } = this.settings;
    const fields = toDeadLetterFields(entry.fields, {
      ...details,
      sourceId: entry.id,
      group,
      consumer,
    });
    await this.redis.xadd(
      deadLetterKey,
      'MAXLEN',
      '~',
      String(deadLetterMaxLength),
      '*',
      ...fields,
    );
    await this.redis.xack(streamKey, group, entry.id);
  }

  async release(): Promise<boolean> {
    const { streamKey, group, consumer } = this.settings;
    const reply = await this.redis.xpending(streamKey, group, '-', '+', 1, consumer);
    if (parseReply(pendingReplySchema, reply, 'XPENDING').length > 0) {
      return false;
    }
    await this.redis.xgroup('DELCONSUMER', streamKey, group, consumer);
    return true;
  }

  async stats(): Promise<GroupStats | undefined> {
    const { streamKey, group } = this.settings;
    const reply = await this.redis.xinfo('GROUPS', streamKey);
    for (const fields of parseReply(groupsInfoReplySchema, reply, 'XINFO GROUPS')) {
      const info = groupInfoSchema.safeParse(fieldsToRecord(fields));
      if (info.success && info.data.name === group) {
        return { lag: info.data.lag ?? undefined, pending: info.data.pending };
      }
    }
    return undefined;
  }
}

/** Duz alan listesini ([ad, deger, ...]) nesneye cevirir; semadan gecmeden kullanilmaz. */
function fieldsToRecord(fields: readonly (string | number | null)[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (let index = 0; index + 1 < fields.length; index += 2) {
    record[String(fields[index])] = fields[index + 1];
  }
  return record;
}

/** Grup yok: akis silinmis ya da Redis verisiz yeniden baslamis. */
export function isNoGroupError(error: unknown): boolean {
  return hasReplyPrefix(error, 'NOGROUP');
}

/** Redis hata cevaplari kodla baslar ("BUSYGROUP Consumer Group name already exists"). */
function hasReplyPrefix(error: unknown, code: string): boolean {
  return error instanceof Error && error.message.startsWith(`${code} `);
}

function parseReply<T>(schema: z.ZodType<T>, reply: unknown, command: string): T {
  const parsed = schema.safeParse(reply);
  if (!parsed.success) {
    throw AppError.internal(`Beklenmeyen ${command} cevabi`, {
      details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
    });
  }
  return parsed.data;
}
