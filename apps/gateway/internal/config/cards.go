package config

// Kart kasasi (T11.17): uclar payment-svc'deki CardVaultService'e gider.
// Ayri dosyadadir: config.go kart ayariyla buyumesin (dosya boyutu kurali).

// PaymentService, kart kasasinin (payment-svc) havuz adi ve /healthz'deki adi.
const PaymentService = "payment"

// defaultPaymentAddress, PAYMENT_GRPC_ADDR verilmezse (port haritasi: payment 50054).
const defaultPaymentAddress = "localhost:50054"

// CardVaultEnabled, kart uclari acik mi (K1): yalnizca production DISINDA.
// Saglayici bugun mock'tur: test kartlari kendi kararini alir, Luhn'u gecerli
// ve markasi desteklenen HER kart onaylanir (bekleyen is 112). Gercek saglayici
// gelene kadar uclar canlida HIC baglanmaz ve payment /healthz listesine girmez.
func (c Config) CardVaultEnabled() bool {
	return cardVaultEnabled(c.NodeEnv)
}

func cardVaultEnabled(nodeEnv string) bool {
	return nodeEnv != EnvProduction
}

// cardVaultTargets, kart uclari aciksa payment hedefi; degilse bos liste.
func cardVaultTargets(getenv Getenv, nodeEnv string) []ServiceTarget {
	if !cardVaultEnabled(nodeEnv) {
		return nil
	}
	return []ServiceTarget{{Name: PaymentService, Address: readString(getenv, "PAYMENT_GRPC_ADDR", defaultPaymentAddress)}}
}
