/**
 * Charge use-case: siparis tutarini ceker.
 *
 * Akis: (1) ayni anahtarla gelen tekrar istek ilk kaydi doner (kart ARANMAZ:
 * kart sonradan silinmis olsa da ilk sonuc), (2) siparisin baska bir odemesi
 * varsa CONFLICT, (3) kayitli kart cozulur (charge-card.ts; yoksa NOT_FOUND,
 * kayit YAZILMAZ), (4) PENDING kayit yazilir - siparisi ve anahtari
 * SAHIPLENIR, (5) kartsa saglayiciya gidilir, (6) karar kayda islenir.
 *
 * Kayit saglayicidan ONCE yazildigi icin ayni anahtarla es zamanli iki istekte
 * ikincisi insert'te CONFLICT alir, tekrar-istek yoluna duser ve saglayiciya
 * HIC gitmez: cift cekim olmaz.
 */

import { AppError } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import {
  failUnreachableProvider,
  isSameCharge,
  settlePayment,
  startPayment,
  withRequiredThreeDs,
} from '../domain/charge.js';
import type { ChargeCommand } from '../domain/charge.js';
import { PAYMENT_METHOD } from '../domain/payment.js';
import type { Payment } from '../domain/payment.js';
import type { PaymentProvider } from '../domain/payment-provider.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { paymentAlreadyExists } from '../domain/payment-repository.js';
import { resolveChargeCard, withoutProviderToken } from './charge-card.js';
import type { CardSource, ChargeCardDeps } from './charge-card.js';

export interface ChargeDeps extends ChargeCardDeps {
  readonly repository: PaymentRepository;
  /** Yalnizca cekim karari; 3DS dogrulamasi bu use-case'in isi degil. */
  readonly provider: Pick<PaymentProvider, 'authorize'>;
  readonly clock: Clock;
  readonly challengeTtlMs: number;
}

export interface ChargeInput extends ChargeCommand {
  /**
   * Kartli odemede tam biri (sema dogrular): kasadaki kart ya da eski jeton;
   * kapida odemede yok. Cekim NIYETININ parcasi degil (isSameCharge'a girmez).
   */
  readonly card: CardSource | undefined;
  /**
   * Risk'in "3DS zorunlu" karari (T7.1). Cekim NIYETININ parcasi degil,
   * politikadir: tekrar-istek karsilastirmasina (isSameCharge) girmez ve
   * kayda yazilmaz; etkisi karar ve deneme gecmisinde gorunur.
   */
  readonly requireThreeDs: boolean;
}

/**
 * `logger` CAGRININ gunlukcusudur (handler'in ctx.logger'i: rpc + requestId
 * bagli). Servis geneli gunlukcu bilerek bagimlilik degil: onunla yazilan
 * satirda requestId olmaz ve hata hangi istege ait bulunamaz.
 */
export type Charge = (input: ChargeInput, logger: Logger) => Promise<Payment>;

export function createCharge(deps: ChargeDeps): Charge {
  return async ({ card, requireThreeDs, ...command }, logger) => {
    const replay = await findReplay(deps.repository, command);
    if (replay !== null) {
      return replay;
    }
    if ((await deps.repository.findByOrderId(command.orderId)) !== null) {
      throw paymentAlreadyExists(command.orderId);
    }

    // Kayitli kart kayittan ONCE: kart yoksa kayit yazilmaz, anahtar harcanmaz.
    const resolved =
      card === undefined ? undefined : await resolveChargeCard(deps, command.userId, card);
    const started = startPayment(command, deps.clock);
    const pending =
      resolved?.cardId === undefined ? started : { ...started, cardId: resolved.cardId };
    try {
      await deps.repository.insert(pending);
    } catch (error) {
      // Es zamanli ayni anahtar: kazanan kaydi yazdi, kaybeden onu doner.
      const winner = await findReplay(deps.repository, command);
      if (winner !== null) {
        return winner;
      }
      throw error;
    }

    // Kapida odemede saglayiciya gidilmez: tutar teslimatta alinir. (Kartli
    // odemede kartin varligini sema garanti eder; ikinci kosul tip daraltmadir.)
    if (command.method === PAYMENT_METHOD.CASH_ON_DELIVERY || resolved === undefined) {
      return pending;
    }
    const settled = await authorizeAndSettle(
      deps,
      pending,
      { cardToken: resolved.providerToken, requireThreeDs },
      logger,
    );
    await deps.repository.update(settled, pending.version);
    return settled;
  };
}

/** Ayni anahtarli kayit: ayni niyetse onu doner, farkli govdeyse CONFLICT. */
async function findReplay(
  repository: PaymentRepository,
  command: ChargeCommand,
): Promise<Payment | null> {
  const existing = await repository.findByIdempotencyKey(command.idempotencyKey);
  if (existing === null) {
    return null;
  }
  if (!isSameCharge(existing, command)) {
    throw AppError.conflict('Ayni Idempotency-Key farkli bir govde ile kullanildi', {
      details: { idempotencyKey: command.idempotencyKey },
    });
  }
  return existing;
}

async function authorizeAndSettle(
  deps: ChargeDeps,
  pending: Payment,
  card: { readonly cardToken: string; readonly requireThreeDs: boolean },
  logger: Logger,
): Promise<Payment> {
  try {
    const decision = await deps.provider.authorize({
      cardToken: card.cardToken,
      amount: pending.amount,
    });
    const effective = withRequiredThreeDs(decision, card.requireThreeDs);
    return settlePayment(pending, effective, deps.clock, deps.challengeTtlMs);
  } catch (error) {
    // Hata istemciye degil gunluge: tutar cekilmedi, kayit FAILED olur. Saglayicinin
    // hata metni jetonu yankilayabilir: gunluge jetonsuz kopyasi (T12.4).
    logger.error(
      { err: withoutProviderToken(error, card.cardToken), orderId: pending.orderId },
      'odeme saglayicisina ulasilamadi',
    );
    return failUnreachableProvider(pending, deps.clock);
  }
}
