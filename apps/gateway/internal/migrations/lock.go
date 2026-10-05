package migrations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Kilit ayarlari (mongo-kit migration-lock.ts ile ayni).
const (
	// DefaultLockTTL, kilidin omru: en uzun gocten belirgin uzun. Coken
	// calismanin kilidi omru dolunca duser.
	DefaultLockTTL = 10 * time.Minute
	// DefaultLockPoll, dolu kilidin yeniden denenme araligi.
	DefaultLockPoll = 500 * time.Millisecond
	lockID          = "migrations"
)

// ErrLockLost, kilit omru dolup baska kopyaya gecmis: calisma durur.
var ErrLockLost = errors.New("goc kilidi kaybedildi: omru dolup baska kopyaya gecmis")

// LockOptions, kilidin ayarlari; sifir deger varsayilandir.
type LockOptions struct {
	TTL  time.Duration
	Poll time.Duration
	// Owner, sahiplik belirteci; bossa kopyaya ozgu rastgele.
	Owner string
	Now   func() time.Time
	// Sleep, beklemenin kendisi (testte hizlandirilir); baglam iptalinde doner.
	Sleep func(ctx context.Context, d time.Duration) error
}

// lock, `migrations_lock`'taki tek belge: { _id, owner, acquiredAt, expiresAt }.
//
// Alma TEK atomik islemdir: belge yoksa, omru dolmussa ya da zaten bizdeyse
// yazilir (upsert). Baskasindaysa filtre tutmaz, upsert ayni `_id` ile eklemeye
// kalkar ve benzersizlik ihlaliyle reddedilir: kilit dolu.
type lock struct {
	collection *mongo.Collection
	options    LockOptions
	logger     *slog.Logger
}

func newLock(db *mongo.Database, logger *slog.Logger, opts LockOptions) (*lock, error) {
	if opts.TTL <= 0 {
		opts.TTL = DefaultLockTTL
	}
	if opts.Poll <= 0 {
		opts.Poll = DefaultLockPoll
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.Sleep == nil {
		opts.Sleep = sleep
	}
	if opts.Owner == "" {
		owner, err := randomOwner()
		if err != nil {
			return nil, err
		}
		opts.Owner = owner
	}
	return &lock{collection: db.Collection(LockCollection), options: opts, logger: logger}, nil
}

// acquire, kilidi alana kadar bekler. En kotu durumda baskasinin kilidinin
// omru dolar ve alinir; sahibi omru yenilemeye devam ederse (uzun goc) omur
// kadar beklendikten sonra hata.
func (l *lock) acquire(ctx context.Context) error {
	deadline := l.options.Now().Add(l.options.TTL + l.options.Poll)
	announced := false
	for {
		taken, err := l.tryAcquire(ctx)
		if err != nil || taken {
			return err
		}
		if !announced {
			l.logger.InfoContext(ctx, "goc kilidi baska kopyada; bitmesi bekleniyor")
			announced = true
		}
		if !l.options.Now().Before(deadline) {
			return fmt.Errorf("goc kilidi %s icinde alinamadi", l.options.TTL)
		}
		if err := l.options.Sleep(ctx, l.options.Poll); err != nil {
			return err
		}
	}
}

// renew, omru uzatir; kilit artik bizde degilse ErrLockLost.
func (l *lock) renew(ctx context.Context) error {
	result, err := l.collection.UpdateOne(ctx,
		bson.D{{Key: "_id", Value: lockID}, {Key: "owner", Value: l.options.Owner}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "expiresAt", Value: l.options.Now().Add(l.options.TTL)}}}})
	if err != nil {
		return fmt.Errorf("goc kilidi yenilenemedi: %w", err)
	}
	if result.MatchedCount == 0 {
		return ErrLockLost
	}
	return nil
}

// release, yalnizca sahibi birakir; birakilamazsa omru dolunca duser. Kapanis
// yolunda cagrildigi icin hatayi doner degil gunluge yazar.
func (l *lock) release(ctx context.Context) {
	if _, err := l.collection.DeleteOne(ctx, bson.D{{Key: "_id", Value: lockID}, {Key: "owner", Value: l.options.Owner}}); err != nil {
		l.logger.WarnContext(ctx, "goc kilidi birakilamadi; omru dolunca duser", slog.Any("err", err))
	}
}

func (l *lock) tryAcquire(ctx context.Context) (bool, error) {
	now := l.options.Now()
	filter := bson.D{
		{Key: "_id", Value: lockID},
		{Key: "$or", Value: bson.A{
			bson.D{{Key: "owner", Value: l.options.Owner}},
			bson.D{{Key: "expiresAt", Value: bson.D{{Key: "$lte", Value: now}}}},
		}},
	}
	update := bson.D{{Key: "$set", Value: bson.D{
		{Key: "owner", Value: l.options.Owner},
		{Key: "acquiredAt", Value: now},
		{Key: "expiresAt", Value: now.Add(l.options.TTL)},
	}}}
	_, err := l.collection.UpdateOne(ctx, filter, update, options.UpdateOne().SetUpsert(true))
	if mongo.IsDuplicateKeyError(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("goc kilidi alinamadi: %w", err)
	}
	return true, nil
}

// sleep, baglam iptaline duyarli bekleme.
func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// randomOwner, kopyaya ozgu sahiplik belirteci (16 rastgele bayt).
func randomOwner() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("kilit sahibi uretilemedi: %w", err)
	}
	return hex.EncodeToString(buffer), nil
}
