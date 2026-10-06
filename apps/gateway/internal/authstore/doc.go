// Package authstore, kimlik kayitlarinin depolaridir (T8.1): Mongo (gercek) ve
// bellek (MOCK). Surucu hatasini auth paketinin hatalarina cevirir; servis
// Mongo'yu bilmez.
//
// Koleksiyonlar gateway'indir (ADR-05): users (telefon benzersiz) ve sessions
// (yenileme jetonunun ozeti benzersiz, suresi dolan kayit TTL indeksiyle
// kendiliginden silinir).
package authstore

// Bellek ici depolar: MOCK=true'da Mongo olmadan calismak ve servis testleri
// icin. Kurallari Mongo'dakiyle AYNIDIR (telefon benzersiz, yenileme atomik,
// suresi dolan oturum yenilenmez); sureci kapaninca icerik kaybolur.
