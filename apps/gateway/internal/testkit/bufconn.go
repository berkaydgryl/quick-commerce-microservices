package testkit

import (
	"context"
	"errors"
	"net"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

// bufconnSize, bellek ici baglantinin tamponu (1 MB). Testlerin tasidigi
// mesajlar bunun cok altindadir.
const bufconnSize = 1 << 20

// BufconnClient, bellek ici (bufconn) GERCEK bir gRPC sunucusu kurar, sahte
// servisi register ile baglar ve sunucuya bagli istemci baglantisini dondurur.
//
// NEDEN GERCEK SUNUCU: adaptor testlerinde asil sinanan sey istegin ve
// trailer'in (x-app-error) telden gecip adaptore ulasmasidir; sahte istemci
// bunu taklit ederdi. Ag yok, port yok: testler paralel ve belirlenebilir.
//
// Sunucu ve baglanti test bitince kapatilir. Normal kapanis disindaki her hata
// testi dusurur; yutulan bir Serve hatasi testin neden takildigini gizlerdi.
func BufconnClient(t *testing.T, register func(*grpc.Server)) *grpc.ClientConn {
	t.Helper()

	listener := bufconn.Listen(bufconnSize)
	server := grpc.NewServer()
	register(server)
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		// Stop, Serve baslamadan cagrilirsa Serve ErrServerStopped doner; bu
		// normal kapanistir.
		if err := <-served; err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Errorf("gRPC test sunucusu hatayla durdu: %v", err)
		}
	})

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("gRPC istemcisi kurulamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("gRPC baglantisi kapanmadi: %v", closeErr)
		}
	})
	return conn
}
