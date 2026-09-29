// Package mongodb, gateway'in Mongo baglantisidir (T8.1).
//
// Gateway `users` ve `sessions` koleksiyonlarinin sahibidir (ADR-05, roadmap
// koleksiyon tablosu); baska servislerin koleksiyonlarina DOKUNMAZ, onlara
// gRPC ile ulasir.
package mongodb

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// Options, baglanti ayarlari.
type Options struct {
	URI string
	// ServerSelectionTimeout, uygun sunucu bulunana kadar beklenecek en uzun
	// sure (MONGO_SERVER_SELECTION_TIMEOUT_MS; Node servisleriyle ayni).
	ServerSelectionTimeout time.Duration
	// OperationTimeout, tek bir islemin ust siniri. Istegin baglaminda son
	// tarih yoksa surucu bunu uygular: takilan bir Mongo istegi sonsuza kadar
	// bekletmez (gRPC cagrilarindaki GATEWAY_REQUEST_TIMEOUT_MS ile ayni sinir).
	OperationTimeout time.Duration
}

// Connect, istemciyi kurar ve birincil sunucuya ulasildigini dogrular.
//
// NEDEN ACILISTA PING: surucu baglantiyi tembel kurar; ping olmadan Mongo
// kapaliyken gateway "ayakta" gorunur ve ilk kayit isteginde patlardi. Hata
// acilisa cekilir.
func Connect(ctx context.Context, opts Options) (*mongo.Client, error) {
	client, err := mongo.Connect(options.Client().
		ApplyURI(opts.URI).
		SetServerSelectionTimeout(opts.ServerSelectionTimeout).
		SetTimeout(opts.OperationTimeout))
	if err != nil {
		return nil, fmt.Errorf("mongo istemcisi kurulamadi: %w", err)
	}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		if disconnectErr := client.Disconnect(ctx); disconnectErr != nil {
			return nil, fmt.Errorf("mongo'ya ulasilamadi: %w (kapatma: %w)", err, disconnectErr)
		}
		return nil, fmt.Errorf("mongo'ya ulasilamadi: %w", err)
	}
	return client, nil
}

// Pinger, /healthz icin Mongo'nun ayakta olup olmadigini soyler.
type Pinger struct {
	client *mongo.Client
}

// NewPinger, istemciyle kurar.
func NewPinger(client *mongo.Client) Pinger {
	return Pinger{client: client}
}

// Ping, birincil sunucuya ulasilabiliyor mu?
func (p Pinger) Ping(ctx context.Context) error {
	if err := p.client.Ping(ctx, readpref.Primary()); err != nil {
		return fmt.Errorf("mongo ping: %w", err)
	}
	return nil
}
