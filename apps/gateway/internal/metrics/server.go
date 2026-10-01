package metrics

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// Path, metriklerin okundugu tek yol.
const Path = "/metrics"

// CloseGrace, kapanista suren kazimanin en uzun beklenecegi sure (Node'daki
// METRICS_CLOSE_GRACE_MS ile ayni); dolarsa baglantilar kesilir.
const CloseGrace = time.Second

// readHeaderTimeout, yavas istemcinin baglantiyi tutabilecegi sure (Slowloris).
const readHeaderTimeout = 5 * time.Second

// Server, /metrics ucu (#29): yalnizca GET /metrics; /metrics'e baska fiil
// 405 (Allow: GET), baska her yol 404. Ayri porttadir (GATEWAY_PORT + 1000):
// istemcilere acik API portu metrik gostermez.
type Server struct {
	server   *http.Server
	listener net.Listener
	served   chan struct{}
}

// Listen, ucu acar ve arka planda sunar. Port doluysa hata doner (acilis durur).
func Listen(ctx context.Context, addr string, handler http.Handler, logger *slog.Logger) (*Server, error) {
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("metrik portu acilamadi (%s): %w", addr, err)
	}
	s := &Server{
		server:   &http.Server{Handler: onlyMetrics(handler), ReadHeaderTimeout: readHeaderTimeout},
		listener: listener,
		served:   make(chan struct{}),
	}
	go func() {
		defer close(s.served)
		if serveErr := s.server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			logger.Error("metrik ucu durdu", slog.Any("err", serveErr))
		}
	}()
	return s, nil
}

// Addr, dinlenen adres (port 0 verildiyse isletim sisteminin sectigi).
func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

// Close, yeni baglanti kabul etmez ve suren kazimayi en cok CloseGrace bekler.
func (s *Server) Close(ctx context.Context) error {
	graceCtx, cancel := context.WithTimeout(ctx, CloseGrace)
	defer cancel()
	err := s.server.Shutdown(graceCtx)
	if err != nil {
		// Suren kazima bitmedi: baglantilar kesilir, kapanis beklemez.
		err = errors.Join(fmt.Errorf("metrik ucu suresinde kapanmadi: %w", err), s.server.Close())
	}
	<-s.served
	return err
}

// onlyMetrics, yolu ve fiili denetler; gerisini defterin isleyicisine birakir.
func onlyMetrics(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != Path {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		handler.ServeHTTP(w, r)
	})
}
