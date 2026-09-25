// Package clients, gateway'in konustugu gRPC baglantilarini tutar.
//
// NEDEN HAVUZ: gRPC baglantisi (ClientConn) uzun omurludur ve kendi icinde
// yeniden baglanma, ad cozumleme ve yuk dagitimi yapar. Her istekte yeni
// baglanti acmak hem el sikismayi tekrarlar hem de dosya tanimlayicilarini
// tuketir. Baglantilar acilista bir kez kurulur, kapanista hep birlikte kapanir.
package clients

import (
	"errors"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

// Target, tek bir servisin adi ve adresi.
type Target struct {
	Name    string
	Address string
}

// Keepalive ayarlari: bos baglanti ag ekipmani tarafindan sessizce dusurulurse
// ilk istek zaman asimina ugrar. Duzenli ping bunu erken fark ettirir.
const (
	keepaliveTime    = 30 * time.Second
	keepaliveTimeout = 10 * time.Second
)

// Pool, ada gore gRPC baglantilari.
type Pool struct {
	conns map[string]*grpc.ClientConn
}

// NewPool, verilen hedefler icin baglanti nesnelerini kurar.
//
// DIKKAT: grpc.NewClient TEMBELDIR; TCP baglantisi ilk cagrida kurulur. Bu
// bilincli bir tercih - gateway, bagimli servis henuz ayaga kalkmamis olsa bile
// baslayabilmeli ve bunu /healthz uzerinden bildirebilmelidir. Aksi halde acilis
// sirasi bir bagimlilik zinciri olurdu.
func NewPool(targets []Target) (*Pool, error) {
	pool := &Pool{
		conns: make(map[string]*grpc.ClientConn, len(targets)),
	}

	for _, target := range targets {
		conn, err := grpc.NewClient(
			target.Address,
			// TLS YOK: servisler yalnizca ic agda konusur, disariya acilmaz.
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithKeepaliveParams(keepalive.ClientParameters{
				Time:    keepaliveTime,
				Timeout: keepaliveTimeout,
			}),
		)
		if err != nil {
			// Acilan baglantilari birakmadan cik: yarim havuz sizinti demektir.
			// Kapanis da hata verirse o hata yutulmaz; asil hatayla birlikte doner
			// (errors.Join nil'i atlar, kapanis temizse yalnizca asil hata kalir).
			setupErr := fmt.Errorf("gRPC istemcisi kurulamadi (%s -> %s): %w", target.Name, target.Address, err)
			return nil, errors.Join(setupErr, pool.Close())
		}

		pool.conns[target.Name] = conn
	}

	return pool, nil
}

// Conn, servisin baglantisini verir.
func (p *Pool) Conn(name string) (*grpc.ClientConn, bool) {
	conn, ok := p.conns[name]
	return conn, ok
}

// Close, tum baglantilari kapatir. Bir kapanis hata verse bile digerleri
// denenir; hatalarin tamami birlestirilerek dondurulur.
func (p *Pool) Close() error {
	var problems []error
	for name, conn := range p.conns {
		if err := conn.Close(); err != nil {
			problems = append(problems, fmt.Errorf("%s baglantisi kapatilamadi: %w", name, err))
		}
	}
	return errors.Join(problems...)
}
