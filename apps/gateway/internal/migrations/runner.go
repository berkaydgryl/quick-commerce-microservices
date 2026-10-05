package migrations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Runner, bir veritabaninin goc calistiricisi.
//
// Akis (Up; mongo-kit migration-runner.ts ile ayni):
//  1. Kayitlar okunur ve kodla karsilastirilir; tutarsizlik varsa durur.
//  2. Bekleyen yoksa biter: KILIT ALINMAZ (her acilista yazim olmasin).
//  3. Kilit alinir (ikinci kopya burada bekler); kayitlar YENIDEN okunur:
//     beklerken obur kopya hepsini uygulamis olabilir.
//  4. Her bekleyen icin: kilidin omru yenilenir, goc uygulanir, kaydi yazilir.
//     Kayit `_id`'si surum oldugu icin kilit bir sebeple asilsa bile ayni goc
//     iki kez kaydedilemez.
//  5. Kilit birakilir.
type Runner struct {
	db      *mongo.Database
	list    []Migration
	logger  *slog.Logger
	now     func() time.Time
	records *mongo.Collection
	lock    *lock
}

// NewRunner, listeyi dogrular ve calistiriciyi kurar.
func NewRunner(db *mongo.Database, list []Migration, logger *slog.Logger, opts LockOptions) (*Runner, error) {
	if err := checkList(list); err != nil {
		return nil, err
	}
	logger = logger.With(slog.String("component", "migrations"))
	locker, err := newLock(db, logger, opts)
	if err != nil {
		return nil, err
	}
	return &Runner{
		db: db, list: list, logger: logger, now: locker.options.Now,
		records: db.Collection(RecordsCollection), lock: locker,
	}, nil
}

// Apply, gateway acilisinda: bekleyen gocleri uygular (indekslerden ONCE).
// Tutarsizlik ya da hata acilisi durdurur: kod, uygulanmamis semayla calismamali.
func Apply(ctx context.Context, db *mongo.Database, logger *slog.Logger) error {
	runner, err := NewRunner(db, All(), logger, LockOptions{})
	if err != nil {
		return err
	}
	_, err = runner.Up(ctx)
	return err
}

// Status, kilitsiz okuma: uygulanmis, bekleyen ve tutarsizliklar.
func (r *Runner) Status(ctx context.Context) (Status, error) {
	cursor, err := r.records.Find(ctx, bson.D{})
	if err != nil {
		return Status{}, fmt.Errorf("goc kayitlari okunamadi: %w", err)
	}
	var records []Record
	if err := cursor.All(ctx, &records); err != nil {
		return Status{}, fmt.Errorf("goc kayitlari cozulemedi: %w", err)
	}
	return compare(records, r.list), nil
}

// Up, bekleyenleri surum sirasinda uygular; uygulananlarin kayitlarini doner.
func (r *Runner) Up(ctx context.Context) ([]Record, error) {
	before, err := r.consistentStatus(ctx)
	if err != nil {
		return nil, err
	}
	if len(before.Pending) == 0 {
		r.logger.InfoContext(ctx, "gocler guncel", slog.Int("uygulanmis", len(before.Applied)))
		return nil, nil
	}
	return withLock(ctx, r.lock, func() ([]Record, error) {
		current, err := r.consistentStatus(ctx)
		if err != nil {
			return nil, err
		}
		applied := make([]Record, 0, len(current.Pending))
		for _, migration := range current.Pending {
			if err := r.lock.renew(ctx); err != nil {
				return applied, err
			}
			record, err := r.applyUp(ctx, migration)
			if err != nil {
				return applied, err
			}
			r.logger.InfoContext(ctx, "goc uygulandi",
				slog.Int("surum", record.Version), slog.String("ad", record.Name), slog.Int64("sureMs", record.DurationMs))
			applied = append(applied, record)
		}
		if len(applied) == 0 {
			r.logger.InfoContext(ctx, "gocleri baska kopya uyguladi", slog.Int("uygulanmis", len(current.Applied)))
		}
		return applied, nil
	})
}

// Down, en son uygulanan TEK gocu geri alir; uygulanmis goc yoksa false.
// Elle komutu yoktur: yalnizca testler (up, down, up) kullanir.
func (r *Runner) Down(ctx context.Context) (Record, bool, error) {
	type result struct {
		record Record
		found  bool
	}
	outcome, err := withLock(ctx, r.lock, func() (result, error) {
		current, err := r.Status(ctx)
		if err != nil || len(current.Applied) == 0 {
			return result{}, err
		}
		last := current.Applied[len(current.Applied)-1]
		var migration *Migration
		for i := range r.list {
			if r.list[i].Version == last.Version && r.list[i].Name == last.Name {
				migration = &r.list[i]
			}
		}
		if migration == nil {
			return result{}, fmt.Errorf("son uygulanan goc kodda yok; geri alinamaz: %d %q", last.Version, last.Name)
		}
		if err := r.lock.renew(ctx); err != nil {
			return result{}, err
		}
		if err := migration.Down(ctx, r.db); err != nil {
			return result{}, fmt.Errorf("goc %d geri alinamadi: %w", last.Version, err)
		}
		if _, err := r.records.DeleteOne(ctx, bson.D{{Key: "_id", Value: last.Version}}); err != nil {
			return result{}, fmt.Errorf("goc kaydi silinemedi: %w", err)
		}
		r.logger.InfoContext(ctx, "goc geri alindi", slog.Int("surum", last.Version), slog.String("ad", last.Name))
		return result{record: last, found: true}, nil
	})
	return outcome.record, outcome.found, err
}

func (r *Runner) applyUp(ctx context.Context, migration Migration) (Record, error) {
	startedAt := r.now()
	if err := migration.Up(ctx, r.db); err != nil {
		return Record{}, fmt.Errorf("goc %d (%s) uygulanamadi: %w", migration.Version, migration.Name, err)
	}
	record := Record{
		Version: migration.Version, Name: migration.Name,
		AppliedAt: r.now().UTC(), DurationMs: r.now().Sub(startedAt).Milliseconds(),
	}
	if _, err := r.records.InsertOne(ctx, record); err != nil {
		return Record{}, fmt.Errorf("goc %d kaydedilemedi: %w", migration.Version, err)
	}
	return record, nil
}

func (r *Runner) consistentStatus(ctx context.Context) (Status, error) {
	status, err := r.Status(ctx)
	if err != nil {
		return Status{}, err
	}
	if len(status.Conflicts) > 0 {
		return Status{}, fmt.Errorf("%w: %s", ErrInconsistent, strings.Join(status.Conflicts, " | "))
	}
	return status, nil
}

// ErrInconsistent, kayitlar kodla tutarsiz: goc uygulanmaz.
var ErrInconsistent = errors.New("gocler kodla tutarsiz; uygulanmadi")

// withLock, isi kilit altinda yapar; kilit HER DURUMDA birakilir. Birakma
// iptal edilmis baglamda da calissin diye iptali tasimayan baglam kullanir.
func withLock[T any](ctx context.Context, locker *lock, work func() (T, error)) (T, error) {
	if err := locker.acquire(ctx); err != nil {
		var zero T
		return zero, err
	}
	defer locker.release(context.WithoutCancel(ctx))
	return work()
}
