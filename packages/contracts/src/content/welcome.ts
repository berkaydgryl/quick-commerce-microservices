/**
 * GET /v1/content/welcome semasinin koku: ekran bloklarini birlestirir (T11.6;
 * R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { CONTENT_FEATURES_MAX } from '../constants.js';
import { accountMenuContentSchema } from './account-menu.js';
import { addressSetupContentSchema } from './address-setup.js';
import { addressesContentSchema } from './addresses.js';
import { appDownloadContentSchema, featureContentSchema } from './app-download.js';
import { appHeaderContentSchema } from './app-header.js';
import { bannerSchema } from './banner.js';
import { contentTextSchema } from './content-text.js';
import { favoritesContentSchema } from './favorites.js';
import { loginCardContentSchema } from './login-card.js';
import { marketListContentSchema } from './market-list.js';
import { ordersContentSchema } from './orders.js';
import { paymentMethodsContentSchema } from './payment-methods.js';
import { profileContentSchema } from './profile.js';

/** GET /v1/content/welcome - oturumsuz ziyaretcinin karsilama ekrani. */
export const welcomeContentSchema = z.object({
  header: z.object({
    /** Logonun iki parcasi: "getir" + "market". */
    brand: contentTextSchema,
    service: contentTextSchema,
    loginLabel: contentTextSchema,
    registerLabel: contentTextSchema,
  }),
  hero: z.object({
    /** Sayfanin h1'i ve banner'in alt metni: slogan gorselin icinde yazilidir. */
    title: contentTextSchema,
    banner: bannerSchema,
  }),
  loginCard: loginCardContentSchema,
  categories: z.object({
    title: contentTextSchema,
  }),
  appDownload: appDownloadContentSchema,
  features: z.array(featureContentSchema).min(1).max(CONTENT_FEATURES_MAX),
  addressSetup: addressSetupContentSchema,
  appHeader: appHeaderContentSchema,
  marketList: marketListContentSchema,
  favorites: favoritesContentSchema,
  /** Hesap menusu (T11.16): sol menu ve Profil acilir menusu. */
  accountMenu: accountMenuContentSchema,
  profile: profileContentSchema,
  /** Odeme Yontemlerim (T11.17). */
  paymentMethods: paymentMethodsContentSchema,
  /** Adreslerim sekmesi (T11.15). */
  addresses: addressesContentSchema,
  /** Gecmis Siparislerim (T11.16). */
  orders: ordersContentSchema,
});

export type WelcomeContent = z.infer<typeof welcomeContentSchema>;
