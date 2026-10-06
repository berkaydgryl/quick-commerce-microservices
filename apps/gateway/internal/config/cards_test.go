package config

import (
	"slices"
	"testing"
)

// Kart kasasi (T11.17, K1): uclar ve payment hedefi yalnizca production DISINDA.

func TestCardVaultIsOnOutsideProductionWithItsAddress(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{"PAYMENT_GRPC_ADDR": "payment:50054"}))
	if err != nil {
		t.Fatalf("yukleme: %v", err)
	}

	if !cfg.CardVaultEnabled() {
		t.Error("gelistirmede kart uclari acik olmali")
	}
	if !slices.Contains(cfg.Services, ServiceTarget{Name: PaymentService, Address: "payment:50054"}) {
		t.Errorf("payment hedefi PAYMENT_GRPC_ADDR'den okunmali: %+v", cfg.Services)
	}
}

func TestCardVaultIsOffInProduction(t *testing.T) {
	// Production yuklemesi kendi zorunlu ayarlarini ister; kural tek basina sinanir.
	if cardVaultEnabled(EnvProduction) || len(cardVaultTargets(envMap(nil), EnvProduction)) != 0 {
		t.Error("production'da kart uclari ve payment hedefi olmamali")
	}
	if !cardVaultEnabled(EnvTest) || !cardVaultEnabled(EnvDevelopment) {
		t.Error("test ve gelistirmede acik olmali")
	}
	if (Config{NodeEnv: EnvProduction}).CardVaultEnabled() {
		t.Error("Config.CardVaultEnabled production'da false olmali")
	}
}
