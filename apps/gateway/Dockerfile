# Gateway - cok asamali imaj (Go).
#
# BUILD BAGLAMI DEPO KOKUDUR (Node servisleriyle ayni kural):
#   docker build -f apps/gateway/Dockerfile -t getir/gateway .
# Gateway, packages/proto'nun uretilen Go koduna "replace" ile bagli (T3.4);
# o klasor baglamin icinde olmak zorunda.

# ---------------------------------------------------------------------------
# 1) builder - sozlesme uretimi, bagimliliklar ve derleme
# ---------------------------------------------------------------------------
# Surum go.mod ile ayni tabandan gelir (1.25); CI ile yerelin ayni derleyiciyi
# kullanmasi icin sabitleniyor.
FROM golang:1.25-alpine AS builder
WORKDIR /src

# buf: gen/ depoya da imaja da GIRMEZ (.dockerignore: **/gen/), burada uretilir.
# Surum CI ile ayni (1.73.0).
COPY --from=bufbuild/buf:1.73.0 /usr/local/bin/buf /usr/local/bin/buf

# Once YALNIZCA modul dosyalari: kaynak degistiginde bagimlilik indirmesi ve
# eklenti derlemesi onbellekten gelsin. packages/proto/go.mod gateway icin de
# sart - "replace" hedefinin go.mod'u yoksa "go mod download" duser.
COPY packages/proto/go.mod packages/proto/go.sum ./packages/proto/
COPY apps/gateway/go.mod apps/gateway/go.sum ./apps/gateway/

# Eklenti surumleri packages/proto/go.mod'dan (tools.go); "@latest" yok, yani
# imajda uretilen kod CI'dakiyle birebir ayni cikar.
WORKDIR /src/packages/proto
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go \
 && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc

WORKDIR /src/apps/gateway
RUN go mod download

# Sozlesme kaynaklari ve Go uretimi. Yalnizca Go sablonu: TS eklentisi
# node_modules'ten gelir ve bu imajda Node yok.
COPY packages/proto /src/packages/proto
WORKDIR /src/packages/proto
RUN buf generate --template buf.gen.go.yaml

WORKDIR /src/apps/gateway
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
