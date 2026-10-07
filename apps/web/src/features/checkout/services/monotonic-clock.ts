/**
 * Odeme sayfasinin TEK saat kaynagi (T12.4; PM ek sarti): rezervasyonun ve
 * 3DS kodunun kalan sureleri, akisin son anlari ve geri sayimlar hep bu
 * monotonik saatten okunur; iki zamanlayici birbirinden kaymaz, duvar saati
 * kaysa da sureler kaymaz.
 */
export const monotonicNow = (): number => performance.now();
