# Gateway - cok asamali imaj (Go).
#
# BUILD BAGLAMI DEPO KOKUDUR (Node servisleriyle ayni kural):
#   docker build -f apps/gateway/Dockerfile -t getir/gateway .
# Bugun gateway yalnizca kendi modulune bagli, ama T3.4'te packages/proto
# "replace" ile baglanacak; baglami simdiden kok tutmak o gun Dockerfile'i
# yeniden yazmaktan ucuzdur.

# ---------------------------------------------------------------------------
# 1) builder - bagimliliklar ve derleme
# ---------------------------------------------------------------------------
# Surum go.mod ile ayni tabandan gelir (1.25); CI ile yerelin ayni derleyiciyi
# kullanmasi icin sabitleniyor.
FROM golang:1.25-alpine AS builder
WORKDIR /src

# Once yalnizca modul dosyalari: kaynak degistiginde bagimlilik indirmesi
# onbellekten gelsin.
COPY apps/gateway/go.mod apps/gateway/go.sum ./apps/gateway/
WORKDIR /src/apps/gateway
RUN go mod download

COPY apps/gateway ./

# CGO_ENABLED=0: tamamen statik ikili. distroless/static icinde libc YOKTUR;
# dinamik baglanan bir ikili orada "no such file or directory" ile duser.
# -trimpath: ikilide yerel dosya yollari kalmasin (tekrarlanabilir derleme).
# -ldflags="-s -w": sembol tablosu ve hata ayiklama bilgisi atilir.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gateway ./cmd/gateway

# ---------------------------------------------------------------------------
# 2) runner - yalnizca ikili
# ---------------------------------------------------------------------------
# distroless/static: kabuk, paket yoneticisi ve libc YOK. Saldiri yuzeyi bir Go
# ikilisi kadar; ":nonroot" etiketi kullaniciyi hazir getirir (uid 65532).
FROM gcr.io/distroless/static-debian12:nonroot AS runner

COPY --from=builder /out/gateway /gateway

# Non-root imaj etiketinden geliyor; yine de acikca yaziliyor ki temel imaj
# degisirse kural gozden kacmasin.
USER nonroot:nonroot

EXPOSE 8080

# Kabuk olmadigi icin HEALTHCHECK exec biciminde ve ikilinin kendi alt
# komutuyla calisir (bkz. cmd/gateway/healthcheck.go).
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/gateway", "healthcheck"]

ENTRYPOINT ["/gateway"]
