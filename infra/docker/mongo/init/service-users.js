// Servis kullanicilari (D14, ADR-05): her servis YALNIZCA kendi veritabaninda
// okur ve yazar (readWrite). Baska servisin koleksiyonuna erisim Mongo
// tarafindan reddedilir.
//
// Kullanici, parola ve veritabani kok .env'deki servis tanimindan okunur
// (<SERVIS>_MONGO_URI, <SERVIS>_MONGO_DB): servisin baglandigi adres ile burada
// olusturulan kullanici tek kaynaktan gelir, ayrismaz.
//
// Mongo imaji bu dosyayi YALNIZCA ilk acilista (bos hacim) kok kullaniciyla
// calistirir. Parola sonradan degisirse hacim sifirlanir (pnpm infra:reset) ya
// da kullanici elle guncellenir (infra/docker/README.md).

const SERVICES = ['CATALOG', 'INVENTORY', 'ORDER', 'PAYMENT', 'RISK', 'COURIER', 'GATEWAY'];

/** Servisin kullanicisi; tanim eksik ya da yanlissa hicbir kullanici olusturulmaz. */
function serviceUser(service) {
  const uriVar = `${service}_MONGO_URI`;
  const raw = process.env[uriVar];
  if (!raw) {
    throw new Error(`${uriVar} yok: kok .env dosyasini .env.example'a gore guncelleyin`);
  }
  const uri = new URL(raw);
  const user = decodeURIComponent(uri.username);
  const password = decodeURIComponent(uri.password);
  if (user === '' || password === '') {
    throw new Error(`${uriVar} kullanici ve parola tasimali: mongodb://kullanici:parola@...`);
  }
  if (uri.searchParams.get('authSource') !== 'admin') {
    throw new Error(`${uriVar} authSource=admin tasimali: kullanicilar admin veritabaninda`);
  }
  const dbName = process.env[`${service}_MONGO_DB`] || `getir_${service.toLowerCase()}`;
  return { user, password, dbName };
}

// Once hepsi denetlenir: yarim kalan kurulumda bazi servisler acilir, bazilari
// acilmaz ve sebep gozden kacardi.
const users = SERVICES.map(serviceUser);
const admin = db.getSiblingDB('admin');
for (const { user, password, dbName } of users) {
  admin.createUser({ user, pwd: password, roles: [{ role: 'readWrite', db: dbName }] });
  print(`servis kullanicisi: ${user} -> ${dbName} (readWrite)`);
}
