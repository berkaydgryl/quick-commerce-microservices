// Package migrations, gateway'in Mongo goclerdir (T11.15; ADR-19 gateway eki).
//
// Node servisleri @getir/mongo-kit'in calistiricisini kullanir; gateway Go'dur
// ve ayni KURALLARI kendi kucuk duzeniyle uygular:
//
//   - Goc gateway'in veritabaninda (getir_gateway) kosar; uygulananlar
//     `migrations` koleksiyonunda surumuyle (`_id`), adiyla ve aninda durur.
//   - Surum artan tam sayidir; uygulanmis goc DEGISTIRILMEZ, duzeltme yeni goctur.
//   - Acilista bekleyenler `migrations_lock` kilidi altinda uygulanir: iki gateway
//     kopyasi ayni anda acilirsa gocu yalnizca biri uygular.
//   - Goc o gunun mantiginin DONMUS kopyasidir: auth ya da authstore tiplerine
//     baglanmaz, yalin Mongo islemleri kullanir.
//   - Transaction yoktur (Node'daki `transaction: false`): goc yarida kalabilir,
//     bu yuzden her goc YENIDEN CALISTIRILABILIR yazilir.
//
// Elle `up/down` komutu yoktur; `down` yalnizca testlerde kullanilir.
package migrations

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Koleksiyonlar: Node calistiricisiyla ayni adlar.
const (
	// RecordsCollection, uygulanan goclerin kaydi.
	RecordsCollection = "migrations"
	// LockCollection, es zamanli calismaya karsi tek belgelik kilit.
	LockCollection = "migrations_lock"
)

// Migration, tek bir goc.
type Migration struct {
	// Version, artan tam sayi (1, 2, 3...): dosya adindaki sira numarasi.
	Version int
	// Name, kisa ad: "adres-kimlikleri".
	Name string
	Up   func(ctx context.Context, db *mongo.Database) error
	Down func(ctx context.Context, db *mongo.Database) error
}

// Record, uygulanmis goc. `_id` surumdur: ayni goc iki kez kaydedilemez.
type Record struct {
	Version    int       `bson:"_id"`
	Name       string    `bson:"name"`
	AppliedAt  time.Time `bson:"appliedAt"`
	DurationMs int64     `bson:"durationMs"`
}

// Status, kayitlarla kodun karsilastirmasi.
type Status struct {
	// Applied, uygulanmislar, surum sirasinda.
	Applied []Record
	// Pending, kodda olup uygulanmamislar, surum sirasinda.
	Pending []Migration
	// Conflicts, calismayi durduran tutarsizliklar; bos degilse goc uygulanmaz.
	Conflicts []string
}

// checkList, goc listesi gecerli mi: surumler pozitif ve ARTAN, adlar dolu ve
// tekil, up ve down var. Liste kodda yazili oldugu icin hata programlama hatasidir.
func checkList(list []Migration) error {
	names := map[string]bool{}
	previous := 0
	for _, migration := range list {
		if migration.Version <= previous {
			return fmt.Errorf("goc listesi gecersiz: surumler artan pozitif tam sayi olmali (%d, onceki %d)", migration.Version, previous)
		}
		if strings.TrimSpace(migration.Name) == "" || names[migration.Name] {
			return fmt.Errorf("goc listesi gecersiz: ad bos ya da tekrar ediyor (%d %q)", migration.Version, migration.Name)
		}
		if migration.Up == nil || migration.Down == nil {
			return fmt.Errorf("goc listesi gecersiz: %d %q up ve down ister", migration.Version, migration.Name)
		}
		names[migration.Name] = true
		previous = migration.Version
	}
	return nil
}

// compare, kayitlarla kodu karsilastirir (mongo-kit migrationStatus'un aynisi).
// Tutarsizlik (calisma durur):
//   - kayitta olup kodda olmayan surum: kod geri alinmis, o gocu bilmiyor;
//   - ayni surum farkli adla: goc dosyasi degistirilmis ya da numara cakismis;
//   - en yeni uygulanmistan KUCUK bekleyen surum: sira bozuk.
func compare(records []Record, list []Migration) Status {
	applied := slices.Clone(records)
	slices.SortFunc(applied, func(a, b Record) int { return a.Version - b.Version })
	byVersion := map[int]Migration{}
	for _, migration := range list {
		byVersion[migration.Version] = migration
	}
	status := Status{Applied: applied}
	appliedVersions := map[int]bool{}
	latest := 0
	for _, record := range applied {
		appliedVersions[record.Version] = true
		migration, known := byVersion[record.Version]
		switch {
		case !known:
			status.Conflicts = append(status.Conflicts, fmt.Sprintf("surum %d (%s) uygulanmis ama kodda yok", record.Version, record.Name))
		case migration.Name != record.Name:
			status.Conflicts = append(status.Conflicts, fmt.Sprintf("surum %d kayitta %q, kodda %q", record.Version, record.Name, migration.Name))
			latest = record.Version
		default:
			latest = record.Version
		}
	}
	for _, migration := range list {
		if appliedVersions[migration.Version] {
			continue
		}
		status.Pending = append(status.Pending, migration)
		if migration.Version < latest {
			status.Conflicts = append(status.Conflicts, fmt.Sprintf("surum %d (%s) bekliyor ama daha yeni %d uygulanmis", migration.Version, migration.Name, latest))
		}
	}
	return status
}
