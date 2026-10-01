package config

import (
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// SeedConfig, persona seed komutunun (cmd/seed-personas, T8.1) yapilandirmasi.
//
// Gateway'in tamamini degil yalnizca seed'in ihtiyacini okur: veri yazmak icin
// JWT sirri ya da gorsel adresi gerekmez. MOCK'a bakmaz: isi Mongo'ya yazmaktir,
// GATEWAY_MONGO_URI her zaman zorunludur (catalog seed'iyle ayni kural).
type SeedConfig struct {
	NodeEnv                     string
	LogLevel                    slog.Level
	MongoURI                    string
	MongoDB                     string
	MongoServerSelectionTimeout time.Duration
}

// LoadSeed, seed ortamini okur; hatalar toplu doner.
func LoadSeed(getenv Getenv) (SeedConfig, error) {
	var problems []error

	level, err := readLogLevel(getenv)
	if err != nil {
		problems = append(problems, err)
	}
	nodeEnv, err := readEnum(getenv, "NODE_ENV", EnvDevelopment, []string{EnvDevelopment, EnvTest, EnvProduction})
	if err != nil {
		problems = append(problems, err)
	}
	mongoURI, err := readMongoURI(getenv, false)
	if err != nil {
		problems = append(problems, err)
	}
	mongoTimeout, err := readDuration(getenv, "MONGO_SERVER_SELECTION_TIMEOUT_MS", defaultMongoServerSelectionTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	if len(problems) > 0 {
		return SeedConfig{}, fmt.Errorf("ortam degiskenleri gecersiz: %w", errors.Join(problems...))
	}
	return SeedConfig{
		NodeEnv:                     nodeEnv,
		LogLevel:                    level,
		MongoURI:                    mongoURI,
		MongoDB:                     readString(getenv, "GATEWAY_MONGO_DB", defaultMongoDB),
		MongoServerSelectionTimeout: mongoTimeout,
	}, nil
}
