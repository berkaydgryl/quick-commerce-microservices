// README ekran goruntuleri (T20.1): calisan web uygulamasinin butun ekranlarini
// sirayla gezer ve docs/screenshots/ altina PNG yazar.
//
// ON KOSUL: yigin ayakta ve web gelistirme modunda (`vite`, demo hesaplar ve kart
// kasasi yalnizca orada var). CI'da .github/workflows/screenshots.yml yigini
// Mongo + Redis ile kaldirir, seed eder ve bu betigi kosar; yerelde:
//
//   pnpm screenshots                         # http://localhost:5173, sistemdeki Chrome
//   SCREENSHOT_BASE_URL=... pnpm screenshots
//   SCREENSHOT_BROWSER=msedge pnpm screenshots   # chrome | msedge | chromium
//
// Tarayici indirmez (playwright-core): sistemde kurulu Chrome/Edge kullanilir.
// Her ekran bagimsiz bir adimdir; biri duserse `_hata-<ad>.png` yazilir, digerleri
// devam eder ve betik sonunda sifirdan farkli kodla cikar.

/* global document, window -- page.evaluate govdeleri tarayicida kosar. */

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const BASE_URL = process.env['SCREENSHOT_BASE_URL'] ?? 'http://localhost:5173';
const BROWSER_CHANNEL = process.env['SCREENSHOT_BROWSER'] ?? 'chrome';
const OUT_DIR = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));

/** Demo hesabi (apps/web/src/features/auth/demo/personas.ts): dusuk risk, uc kayitli adres. */
const PERSONA = 'Ayşe';
/** Kadikoy "Ev" adresine teslim eden market (catalog fixture); minimum sepet 40 TL. */
const MARKET_ID = 'mkt_migros-jet-moda';
/** 3DS isteyen sahte kart (payment-service test-cards.ts); kod MOCK_THREEDS_CODE. */
const THREEDS_CARD = '4000002760003184';
const THREEDS_CODE = '123456';
const PRODUCTS_TO_ADD = 5;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const STEP_TIMEOUT_MS = 20_000;
/** Kurye ancak hazirlik suresinden (ORDER_PREP_SECONDS) sonra yola cikar. */
const COURIER_TIMEOUT_MS = 180_000;
/** Tek ekranin ust siniri (kurye beklemesi dahil); asilirsa adim hata sayilir. */
const STEP_LIMIT_MS = COURIER_TIMEOUT_MS + 60_000;
const IMAGE_WAIT_MS = 5_000;

const failures = [];

/** @param {import('playwright-core').Page} page @param {string} name */
async function shot(page, name, fullPage = false) {
  if (fullPage) await scrollThrough(page);
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT_DIR}${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

/** Yukleniyor katmani kalkana, ag durulana ve gorseller inene kadar bekler. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page
    .getByText('Yükleniyor...')
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined);
  // Tembel (loading=lazy) gorsel ekrana girmedikce hic inmez; beklemenin ust siniri var.
  await page.evaluate(async (limitMs) => {
    const pending = [...document.images].filter((img) => !img.complete);
    const loaded = Promise.all(
      pending.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }),
      ),
    );
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, limitMs))]);
  }, IMAGE_WAIT_MS);
  await dismissToasts(page);
  await page.waitForTimeout(400);
}

/** Tam sayfa goruntuden once sayfayi asagi kaydirir: tembel gorseller insin. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.scrollTo(0, 0);
  });
}

async function dismissToasts(page) {
  const closers = page.getByRole('button', { name: 'Bildirimi kapat' });
  for (const closer of await closers.all()) {
    await closer.click({ timeout: 1_000 }).catch(() => undefined);
  }
}

/** Bir ekrani bagimsiz adim olarak kosar; hata digerlerini durdurmaz. */
async function step(page, name, run) {
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${STEP_LIMIT_MS} ms icinde bitmedi`)), STEP_LIMIT_MS),
      ),
    ]);
  } catch (error) {
    failures.push(name);
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    await page
      .screenshot({ path: `${OUT_DIR}_hata-${name}.png`, fullPage: true })
      .catch(() => undefined);
  }
}

async function newContext(browser, viewport) {
  const mobile = viewport.width < 768;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  return context;
}

async function openWelcome(page) {
  await page.goto(`${BASE_URL}/`);
  await page.getByRole('heading', { name: 'Giriş yap veya kayıt ol' }).waitFor();
}

async function pickPersona(page) {
  await page.getByText('Demo hesaplar').first().click();
  await page.getByRole('button', { name: new RegExp(`^${PERSONA}`) }).click();
  await page.getByRole('dialog').waitFor();
}

async function login(page) {
  await openWelcome(page);
  await pickPersona(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await page.getByRole('button', { name: 'Profil' }).waitFor();
}

async function waitForMarketList(page) {
  await page
    .getByText(/işletme listeleniyor/)
    .first()
    .waitFor();
}

async function fillCart(page) {
  await page.goto(`${BASE_URL}/markets/${MARKET_ID}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  const addButtons = page.getByRole('button', { name: /sepete ekle$/ });
  await addButtons.first().waitFor();
  const count = Math.min(PRODUCTS_TO_ADD, await addButtons.count());
  for (let index = 0; index < count; index += 1) {
    // Eklenen urunun dugmesi adet secicisine donusur; siradaki hep ilk "sepete ekle"dir.
    await addButtons.first().click();
    await page.waitForTimeout(300);
  }
  const increase = page.getByRole('button', { name: /adedini artır$/ }).first();
  await increase.click();
  await increase.click();
}

async function capturePublicScreens(browser) {
  const context = await newContext(browser, DESKTOP);
  const page = await context.newPage();

  await step(page, '01-karsilama', async () => {
    await openWelcome(page);
    await shot(page, '01-karsilama', true);
  });
  await step(page, '02-giris', async () => {
    await openWelcome(page);
    await pickPersona(page);
    await shot(page, '02-giris');
  });
  await step(page, '03-kayit', async () => {
    await page.goto(`${BASE_URL}/kayit`);
    await page.getByRole('dialog').waitFor();
    await shot(page, '03-kayit');
  });
  await step(page, '04-sifre-yenile', async () => {
    await page.goto(`${BASE_URL}/sifremi-unuttum`);
    await page.getByRole('dialog').waitFor();
    await shot(page, '04-sifre-yenile');
  });

  await context.close();
}

/** Ana akis: giris → marketler → market → sepet → odeme → 3DS → onay → kurye → hesap. */
async function captureShoppingFlow(browser) {
  const context = await newContext(browser, DESKTOP);
  const page = await context.newPage();
  let orderUrl = '';

  await step(page, '05-ana-sayfa', async () => {
    await login(page);
    await waitForMarketList(page);
    await shot(page, '05-ana-sayfa');
  });
  await step(page, '06-arama', async () => {
    await page.goto(`${BASE_URL}/?ara=${encodeURIComponent('süt')}`);
    await page.waitForLoadState('networkidle');
    await shot(page, '06-arama');
  });
  await step(page, '07-market', async () => {
    await page.goto(`${BASE_URL}/`);
    await waitForMarketList(page);
    // Favoriler ekrani bos kalmasin diye iki market kalplenir.
    const hearts = page.getByRole('button', { name: 'Favorilere ekle' });
    for (let index = 0; index < 2; index += 1) {
      await hearts.first().click();
      await page.waitForTimeout(300);
    }
    await fillCart(page);
    await shot(page, '07-market');
  });
  await step(page, '08-sepet', async () => {
    await page.goto(`${BASE_URL}/sepet`);
    await page.getByRole('heading', { name: 'Sepetim', level: 1 }).waitFor();
    await shot(page, '08-sepet');
  });
  await step(page, '09-odeme', async () => {
    await page.getByRole('link', { name: /Ödemeye Geç/ }).click();
    await page.getByRole('heading', { name: 'Ödeme', level: 1 }).waitFor();
    await page.getByRole('timer').first().waitFor();
    await shot(page, '09-odeme');
  });
  await step(page, '10-odeme-yontemi', async () => {
    await page
      .getByRole('button', { name: /^(Seç|Değiştir)$/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Kapıda Ödeme').waitFor();
    await shot(page, '10-odeme-yontemi');
  });
  await step(page, '11-kart-ekle', async () => {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Kredi/Banka Kartı' }).click();
    await fillCardForm(dialog);
    await shot(page, '11-kart-ekle');
    await dialog.getByRole('button', { name: 'Devam' }).click();
    // Kart kaydedilince pencere yontem listesine doner, yeni kart secili gelir.
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Seç', exact: true });
    await confirm.waitFor();
    await confirm.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });
  await step(page, '12-3ds', async () => {
    await page.getByRole('checkbox', { name: /^Ön Bilgilendirme Formu/ }).check({ force: true });
    await page.getByRole('button', { name: /^Sipariş Ver/ }).click();
    const dialog = page.getByRole('dialog', { name: '3D Secure Doğrulama' });
    await dialog.waitFor();
    await dialog.getByLabel('Doğrulama kodu').fill(THREEDS_CODE);
    await shot(page, '12-3ds');
    await dialog.getByRole('button', { name: 'Onayla' }).click();
  });
  await step(page, '13-siparis-onay', async () => {
    await page.waitForURL(/\/siparis\/[^/]+\/onay$/);
    await page.getByRole('heading', { level: 1 }).waitFor();
    orderUrl = page.url().replace(/\/siparis\/([^/]+)\/onay$/, '/hesabim/siparislerim/$1');
    await shot(page, '13-siparis-onay');
  });
  await step(page, '14-kurye-haritasi', async () => {
    const courier = page.getByRole('button', { name: 'Kuryem nerede' });
    await courier.waitFor({ timeout: COURIER_TIMEOUT_MS });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            button.textContent?.includes('Kuryem nerede') &&
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true',
        ),
      undefined,
      { timeout: COURIER_TIMEOUT_MS, polling: 2_000 },
    );
    const approaching = page.getByRole('button', { name: 'Konumu gör' });
    if (await approaching.isVisible().catch(() => false)) {
      await approaching.click();
    } else {
      await page.getByRole('button', { name: 'Kuryem nerede' }).click();
    }
    await page.getByLabel('Kuryenin ve teslimat adresinin haritası').waitFor();
    await page.waitForTimeout(4_000);
    await shot(page, '14-kurye-haritasi');
    await page.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click();
  });
  await step(page, '15-siparis-detay', async () => {
    if (orderUrl === '') throw new Error('siparis olusmadi');
    await page.goto(orderUrl);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await shot(page, '15-siparis-detay');
  });

  const accountPages = [
    ['16-hesabim', '/hesabim', 'Hesabım'],
    ['17-adreslerim', '/hesabim/adreslerim', 'Adreslerim'],
    ['18-favoriler', '/hesabim/favoriler', 'Favori İşletmelerim'],
    ['19-siparislerim', '/hesabim/siparislerim', 'Geçmiş Siparişlerim'],
    ['20-odeme-yontemlerim', '/hesabim/odeme-yontemlerim', 'Ödeme Yöntemlerim'],
    ['21-kart-ekle-sayfasi', '/hesabim/odeme-yontemlerim/ekle', 'Kart Ekle'],
  ];
  for (const [name, path, heading] of accountPages) {
    await step(page, name, async () => {
      await page.goto(`${BASE_URL}${path}`);
      await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
      await shot(page, name);
    });
  }

  await context.close();
}

/** @param {import('playwright-core').Locator} dialog */
async function fillCardForm(dialog) {
  await dialog.getByLabel('Karta İsim Ver (Kişisel, İş vb.)').fill('Kişisel');
  await dialog.getByLabel('Kart Numarası').pressSequentially(THREEDS_CARD);
  await dialog.getByLabel('Kart Üzerindeki İsim').fill('AYSE YILMAZ');
  await dialog.getByLabel('Ay').selectOption({ index: 12 });
  await dialog.getByLabel('Yıl').selectOption({ index: 4 });
  await dialog.getByLabel('CVV').fill('123');
  await dialog
    .getByRole('checkbox', { name: /Kullanım Koşulları'nı okudum/ })
    .check({ force: true });
}

/** Adressiz yeni hesap: kayittan sonra iki adimli adres penceresi acilir. */
async function captureAddressSetup(browser) {
  const context = await newContext(browser, DESKTOP);
  const page = await context.newPage();
  await step(page, '22-adres-ekle', async () => {
    await page.goto(`${BASE_URL}/kayit`);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Adın soyadın').fill('Deniz Ekran');
    const phone = `559${String(Date.now()).slice(-7)}`;
    await dialog.getByLabel('Telefon Numarası').fill(phone);
    await dialog.getByLabel('Şifre belirle').fill('Ekran-Goruntusu-2026');
    await dialog.getByRole('button', { name: 'Kayıt ol', exact: true }).click();
    await page.getByRole('heading', { name: 'Teslimat Adresi Ekle' }).waitFor();
    await page.waitForTimeout(3_000);
    await shot(page, '22-adres-ekle');
  });
  await context.close();
}

async function captureMobileScreens(browser) {
  const guest = await newContext(browser, MOBILE);
  const guestPage = await guest.newPage();
  await step(guestPage, '23-mobil-karsilama', async () => {
    await openWelcome(guestPage);
    await shot(guestPage, '23-mobil-karsilama');
  });
  await guest.close();

  const context = await newContext(browser, MOBILE);
  const page = await context.newPage();
  await step(page, '24-mobil-ana-sayfa', async () => {
    await login(page);
    await waitForMarketList(page);
    await shot(page, '24-mobil-ana-sayfa');
  });
  await step(page, '25-mobil-market', async () => {
    await fillCart(page);
    await shot(page, '25-mobil-market');
  });
  await step(page, '26-mobil-sepet', async () => {
    await page.goto(`${BASE_URL}/sepet`);
    await page.getByRole('heading', { name: 'Sepetim', level: 1 }).waitFor();
    await shot(page, '26-mobil-sepet');
  });
  await context.close();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // Onceki kosunun hata goruntuleri ve gunlugu kalmasin.
  for (const file of readdirSync(OUT_DIR)) {
    if (file.startsWith('_')) rmSync(`${OUT_DIR}${file}`);
  }
  const browser = await chromium.launch({
    channel: BROWSER_CHANNEL === 'chromium' ? undefined : BROWSER_CHANNEL,
  });
  try {
    await capturePublicScreens(browser);
    await captureShoppingFlow(browser);
    await captureAddressSetup(browser);
    await captureMobileScreens(browser);
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} ekran alinamadi: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nTum ekranlar ${OUT_DIR} altinda.`);
}

await main();
