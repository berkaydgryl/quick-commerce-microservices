package config

// DemoPasswordReset, kodsuz (demo) sifre yenileme ucu acik mi (T11.9):
// yalnizca production DISINDA. Kimlik kanitlanmadan sifre degistiren uc
// canli ortama cikmaz; gercek SMS kodlu akis gelene kadar.
func (c Config) DemoPasswordReset() bool {
	return c.NodeEnv != EnvProduction
}

// PhoneChangeEnabled, telefon degistirme ve dogrulama uclari acik mi (T11.14
// PR 3): yalnizca production DISINDA. Gercek SMS saglayicisi yok (bekleyen is
// #95); gelistirmede SMS Mailpit'e duser, canlida uc hic baglanmaz.
func (c Config) PhoneChangeEnabled() bool {
	return c.NodeEnv != EnvProduction
}
