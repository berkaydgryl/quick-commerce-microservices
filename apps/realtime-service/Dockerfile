# syntax=docker/dockerfile:1.7

# Realtime servisi - cok asamali imaj.
#
# BUILD BAGLAMI DEPO KOKUDUR (apps/realtime-service degil):
#   docker build -f apps/realtime-service/Dockerfile -t getir/realtime-service .
# Sebebi pnpm workspace: servis @getir/contracts, @getir/core, @getir/observability,
# @getir/redis-kit ve @getir/service-kit paketlerine "workspace:*" ile bagli; bu
# paketler depo kokunun altinda duruyor.
#
# Diger Node servislerinden tek farki: buf YOK. Realtime gRPC sunmaz ve
# @getir/proto'ya bagli degildir; uretilecek sozlesme kodu olmadigi icin derleme
# araci da imaja (builder dahil) alinmaz.

# ---------------------------------------------------------------------------
# 1) base - ortak temel: Node surumu ve pnpm TEK yerde tanimlanir
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack, pnpm surumunu kok package.json'daki "packageManager" alanindan alir.
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# 2) builder - bagimliliklar ve derleme
# ---------------------------------------------------------------------------
FROM base AS builder

# Bagimlilik indirmesi icin yalnizca lockfile ve kok package.json (corepack'in
# pnpm surumunu okumasi icin; gerekcesi apps/risk-service/Dockerfile'da, T3.2).
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile

# turbo ile derlenir: "..." servisin bagli oldugu paketleri de kapsar.
RUN pnpm exec turbo run build --filter=@getir/realtime-service...

# Yalnizca URETIM bagimliliklari ve derlenmis cikti tek klasore toplanir.
# Servisin kendi dosyalarindan yalnizca package.json "files" alani ("dist")
# kopyalanir (D12); icerik CI'da scripts/check-node-image.mjs ile denetlenir.
# node-linker=hoisted: pnpm deploy'un sembolik baglantilari son imajda kirik kalirdi.
RUN pnpm --config.node-linker=hoisted deploy --filter=@getir/realtime-service --prod /app

# ---------------------------------------------------------------------------
# 3) runner - calisma zamani: yalnizca dist, node_modules ve package.json
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app ./

# NON-ROOT: node imaji "node" kullanicisini hazir getirir.
USER node

# Socket.io (websocket) ve metrik ucu (T10.5: port + 1000, HTTP /metrics).
EXPOSE 3001 4001

# Saglik kontrolu servisin KENDI saglik ucunu yoklar (GET /healthz, ayni port).
# Redis hazir degilse 503 -> unhealthy. start-period: acilis (port baglama) payi.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
