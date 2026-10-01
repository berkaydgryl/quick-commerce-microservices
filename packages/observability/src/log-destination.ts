/**
 * Gunlugun stdout hedefi (#56, T10.5): ESLI yazar; yazamazsa gunlugu birakir.
 *
 * NEDEN pino'NUN VARSAYILANI DEGIL: varsayilan hedef (sonic-boom, esizamansiz)
 * process cikarken tamponda kalan satirlari flushSync ile yazar. stdout'un
 * okuyucusu gittiyse (gunluk toplayici coktu, ust surec oldu) yazim EPIPE verir;
 * sonic-boom 4.2 bu dongude EAGAIN disindaki hatayi da tekrar dener ve dongu hic
 * bitmez: SIGTERM alan servis cikamaz (T10.4 canli testinde bulundu). Kapanis
 * yalnizca mikro gorevlerle bittiginde (MOCK) esizamansiz yazimin hatasi
 * cikistan once islenmez; onu yakalayan tek yol da devreye giremez.
 *
 * Esli hedefte tampon yoktur: satir cagri aninda yazilir, cikista bosaltilacak
 * bir sey kalmaz (pino cikis kancasi da kurmaz). Ilk yazim hatasinda gunluk
 * BIRAKILIR, stderr'e bir kez not dusulur ve surec isine - kapanis dahil -
 * devam eder. Bedeli satir basina bir write cagrisi: servisler info seviyesinde
 * basarili istek basina satir yazmaz (unaryHandler'in satiri debug'dir).
 *
 * Hedef surecin omru boyunca yasar; hata dinleyicisi bu yuzden geri alinmaz.
 */

import { writeSync } from 'node:fs';

import { destination } from 'pino';
import type { DestinationStream } from 'pino';

const STDOUT_FD = 1;
const STDERR_FD = 2;

/** stderr'e dusulen tek satirin mesaji (stdout artik yazilamiyor). */
export const STDOUT_LOST_MESSAGE = "stdout'a yazilamiyor; gunluk birakildi";

/**
 * stdout'a esli yazan, ilk yazim hatasinda susan hedef.
 * @param name Gunlukcunun adi; stderr notunda `name` alani olarak gorunur.
 */
export function stdoutDestination(name: string): DestinationStream {
  const stream = destination({ dest: STDOUT_FD, sync: true });
  let lost = false;
  stream.on('error', (error: unknown) => {
    if (!lost) {
      lost = true;
      noteOnStderr(name, error);
    }
  });
  return {
    write: (line: string): void => {
      if (!lost) {
        stream.write(line);
      }
    },
  };
}

/** stderr de kapali olabilir: not en iyi cabadir, hatasi yutulur. */
function noteOnStderr(name: string, error: unknown): void {
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
  const line = JSON.stringify({
    level: 'warn',
    time: new Date().toISOString(),
    name,
    code,
    msg: STDOUT_LOST_MESSAGE,
  });
  try {
    writeSync(STDERR_FD, `${line}\n`);
  } catch {
    // stderr'in de okuyucusu yok: bildirecek yer kalmadi.
  }
}
