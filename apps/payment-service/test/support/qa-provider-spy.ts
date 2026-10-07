/**
 * QA (T15.2, payment PQ1-PQ7): saglayici casusu ve kapilar. Disa bagimliligi YOK (Mongo, Redis,
 * Testcontainers yuklenmez): birim testleri de kullanir (PQ5). Kume (qa-payment-cluster.ts) ayni
 * casusu iki kopyaya verir.
 */

import type {
  CardVerification,
  CardVerifier,
  VerifyCardInput,
} from '../../src/domain/card-verifier.js';
import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderDecision,
  VerifyChallengeInput,
} from '../../src/domain/payment-provider.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

/** Elle acilan kapi. */
export interface Gate {
  open(): void;
  readonly opened: Promise<void>;
}

export function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Ilk `count` cagri `release`'e kadar bekler; `count` gelince `arrived` acilir. Fazlasi BEKLEMEZ:
 * yaris gerilerse (ikinci cagri saglayiciya ulasirsa) test asili kalmaz, sayac denetimi duser.
 */
export interface Hold {
  readonly arrived: Promise<void>;
  release(): void;
}

class Barrier implements Hold {
  private seen = 0;
  private readonly full = gate();
  private readonly released = gate();

  constructor(private readonly count: number) {}

  get arrived(): Promise<void> {
    return this.full.opened;
  }

  release(): void {
    this.released.open();
  }

  async pass(): Promise<void> {
    this.seen += 1;
    if (this.seen > this.count) return;
    if (this.seen === this.count) this.full.open();
    await this.released.opened;
  }
}

/** Mock saglayici + sayac + kapi. Kopyalar ayni casusu paylasir: sayac kumenin toplamidir. */
export class ProviderSpy implements PaymentProvider, CardVerifier {
  authorized = 0;
  /** Authorize kararindan SONRA, kayda yazmadan once (PQ3). */
  afterAuthorize: ((decision: ProviderDecision) => Promise<void> | void) | undefined;
  private readonly mock = new MockPaymentProvider();
  private authorizeHold: Barrier | undefined;
  private verifyHold: Barrier | undefined;

  /** Siradaki authorize cagrilari `release`'e kadar bekler; `count` gelince `arrived`. */
  holdAuthorize(count = 1): Hold {
    const barrier = new Barrier(count);
    this.authorizeHold = barrier;
    return barrier;
  }

  holdVerify(count = 1): Hold {
    const barrier = new Barrier(count);
    this.verifyHold = barrier;
    return barrier;
  }

  async authorize(input: AuthorizeInput): Promise<ProviderDecision> {
    this.authorized += 1;
    await this.authorizeHold?.pass();
    const decision = await this.mock.authorize(input);
    await this.afterAuthorize?.(decision);
    return decision;
  }

  /** Kapanista: test erken duserse bekleyen cagrilar sunucuyu kilitlemesin. */
  releaseAll(): void {
    this.authorizeHold?.release();
    this.verifyHold?.release();
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<boolean> {
    await this.verifyHold?.pass();
    return this.mock.verifyChallenge(input);
  }

  verifyCard(input: VerifyCardInput): Promise<CardVerification> {
    return this.mock.verifyCard(input);
  }
}
