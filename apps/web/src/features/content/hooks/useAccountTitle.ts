import { CONTENT_FALLBACK } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Hesap sayfalarinin adi ("Hesabım"; ust barin Profil menusuyle ayni metin):
 * Hesabim'in sayfa basligi ve telefonda alt sekmelerden donus baglantisi
 * (T11.14 PR 2). Icerik gelmezse yedek; yuklenirken undefined.
 */
export function useAccountTitle(): string | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.appHeader.accountLabel;
  }
  return error === null ? undefined : CONTENT_FALLBACK.accountLabel;
}
