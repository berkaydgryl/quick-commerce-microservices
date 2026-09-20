/**
 * Onekli kimlik uretimi.
 *
 * Neden onek: log ve Redis anahtarlarinda kimligin turu ciplak gozle okunur
 * (ord_..., usr_...), yanlis kimligi yanlis alana gecirmek zorlasir.
 * Uretim crypto.randomUUID temellidir; harici bagimlilik yoktur.
 */

import { randomUUID } from 'node:crypto';

/** Kimlik onekleri - bu sozluk disinda onek uretilmez. */
export const ID_PREFIX = {
  ORDER: 'ord',
  USER: 'usr',
  PAYMENT: 'pay',
  COURIER: 'crr',
  RESERVATION: 'rsv',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/** `ord_5f1c...` bicimindeki kimlik. */
export type PrefixedId<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

/** Onek ile govdeyi ayiran karakter. */
const ID_SEPARATOR = '_';

/** Govde: tireleri atilmis UUIDv4 -> 32 onaltilik karakter. */
const ID_BODY_PATTERN = /^[0-9a-f]{32}$/;

/** Verilen onek ile yeni kimlik uretir. */
export function newId<P extends IdPrefix>(prefix: P): PrefixedId<P> {
  const body = randomUUID().replace(/-/g, '');
  return `${prefix}${ID_SEPARATOR}${body}`;
}

/** Degerin verilen onege sahip gecerli bir kimlik olup olmadigini dogrular. */
export function isId<P extends IdPrefix>(prefix: P, value: unknown): value is PrefixedId<P> {
  if (typeof value !== 'string') {
    return false;
  }
  const head = `${prefix}${ID_SEPARATOR}`;
  if (!value.startsWith(head)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(head.length));
}
