package config

import (
	"strings"
	"testing"
)

func TestLoadSeedNeedsOnlyMongo(t *testing.T) {
	// Seed JWT sirri ya da gorsel adresi istemez; yalnizca Mongo.
	cfg, err := LoadSeed(envMap(map[string]string{"MONGO_URI": testMongoURI}))
	if err != nil {
		t.Fatalf("yalnizca MONGO_URI ile kurulmali: %v", err)
	}
	if cfg.MongoURI != testMongoURI || cfg.MongoDB != defaultMongoDB || cfg.NodeEnv != EnvDevelopment {
		t.Errorf("varsayilanlar: %+v", cfg)
	}
}

func TestLoadSeedRequiresMongoEvenInMockMode(t *testing.T) {
	// Seed'in isi Mongo'ya yazmaktir; MOCK=true onu bellege cevirmez.
	_, err := LoadSeed(envMap(map[string]string{"MOCK": "true"}))
	if err == nil || !strings.Contains(err.Error(), "MONGO_URI") {
		t.Errorf("MONGO_URI zorunlu olmali: %v", err)
	}
}
