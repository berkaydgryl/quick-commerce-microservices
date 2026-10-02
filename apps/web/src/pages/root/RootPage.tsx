import { useWelcomeContent } from '../../features/content/hooks/useWelcomeContent';
import { useSessionStore } from '../../shared/session/session-store';
import { HomePage } from '../home/HomePage';
import { WelcomePage } from '../welcome/WelcomePage';

/**
 * "/" kapisi (T11.6): oturumsuz ziyaretci karsilama ekranini, oturumdaki
 * kullanici ana sayfayi gorur.
 *
 * Acilistaki sessiz yenileme bitene kadar hicbir sey cizilmez: oturumu acik
 * kullanici karsilama ekranini bir an gormesin. Karsilama icerigi bu surede
 * paralel istenir; oturum aciksa istenmez.
 */
export function RootPage() {
  const status = useSessionStore((state) => state.status);
  useWelcomeContent(status !== 'authenticated');

  if (status === 'unknown') {
    return null;
  }
  return status === 'anonymous' ? <WelcomePage /> : <HomePage />;
}
