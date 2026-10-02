import type { PhoneCountry } from '@getir/contracts';

/**
 * Secili ulke: kod listede yoksa ilk ulke (icerik en az bir ulke garanti eder).
 * Numaradan ulke: kodu numaranin basiyla eslesen ilk ulke (demo hesaplari,
 * sayfalar arasi numara).
 */
export function countryByCode(
  countries: readonly PhoneCountry[],
  code: string,
): PhoneCountry | undefined {
  return countries.find((country) => country.code === code) ?? countries[0];
}

export function countryByDialCode(
  countries: readonly PhoneCountry[],
  dialCode: string,
): PhoneCountry | undefined {
  return countries.find((country) => country.dialCode === dialCode);
}

export function countryOfPhone(
  countries: readonly PhoneCountry[],
  e164: string,
): PhoneCountry | undefined {
  return countries.find((country) => e164.startsWith(country.dialCode));
}
