# syntax=docker/dockerfile:1.7

# Risk servisi - cok asamali imaj.
#
# BUILD BAGLAMI DEPO KOKUDUR (apps/risk-service degil):
#   docker build -f apps/risk-service/Dockerfile -t getir/risk-service .
# Sebebi pnpm workspace: servis @getir/core, @getir/proto ve @getir/service-kit
# paketlerine "workspace:*" ile bagli; bu paketler depo kokunun altinda duruyor
# ve baglam yalnizca app klasoru olsaydi kurulum cozumlenemezdi.

# ---------------------------------------------------------------------------
# 1) base - ortak temel: Node surumu ve pnpm TEK yerde tanimlanir
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack, pnpm surumunu kok package.json'daki "packageManager" alanindan alir;
# imajda ayri bir surum sabiti tutmuyoruz ki ikisi birbirinden ayrilmasin.
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# 2) builder - bagimliliklar, sozlesme uretimi ve derleme
# ---------------------------------------------------------------------------
FROM base AS builder

# buf, .proto dosyalarindan TypeScript uretmek icin gerekli: packages/proto'nun
# TS kaynagi depoda YOKTUR (uretilir). Eklenti node_modules'ten gelir.
COPY --from=bufbuild/buf:1.73.0 /usr/local/bin/buf /usr/local/bin/buf

# Bagimlilik indirmesi icin YALNIZCA lockfile gerekir: "pnpm fetch" paketleri
# sanal store'a indirir, hicbir package.json'a bakmaz.
#
# NEDEN BOYLE (T3.2'de degisti): onceki surum onbellek icin her paketin
# package.json'unu tek tek kopyaliyordu. Ikinci servis eklenince goruldu ki bu
# liste her yeni pakette HER Dockerfile'da guncellenmek zorunda; unutulursa
# kurulum sessizce eksik kaliyor ve hata cok sonra, derleme adiminda ve
# alakasiz bir mesajla cikiyor. "pnpm fetch" yalnizca lockfile ister: liste
# tutma yuku tamamen kalkar, onbellek ayni sekilde korunur (bu katman yalnizca
# lockfile degistiginde yeniden kosar).
#
# package.json da kopyalaniyor ve bu SART: corepack, kullanacagi pnpm surumunu
# kok package.json'daki "packageManager" alanindan okur. Yalnizca lockfile
# kopyalanirsa corepack o alani bulamaz, EN GUNCEL pnpm'i indirir (denemede
# 9.15.9 yerine 12.5.1 geldi) ve yeni surumun tedarik zinciri politikasi
# lockfile'i reddeder: ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION. Tek dosya,
# nadiren degisir; onbellege de zarari yok.
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile

# turbo ile derliyoruz, "pnpm --filter ... build" ile DEGIL. Sebep: turbo.json'da
# build gorevi generate:ts'e baglidir (packages/proto'nun TypeScript kaynagi
# depoda yoktur, .proto dosyalarindan uretilir). Duz pnpm filtresi bu bagimliligi
# bilmez ve derleme "No inputs were found in config file" ile duser.
# "...", servisin bagimli oldugu paketleri de kapsar.
RUN pnpm exec turbo run build --filter=@getir/risk-service...

# Yalnizca URETIM bagimliliklari ve derlenmis cikti tek klasore toplanir:
# workspace paketleri (@getir/core, @getir/proto, @getir/service-kit) gercek
# dosya olarak kopyalanir, devDependencies disarida kalir.
#
# node-linker=hoisted GEREKLI: pnpm deploy'un varsayilan sembolik-baglantili
# store duzeniyle calismasi mumkun degil (baglantilar hedef klasorun disina
# isaret eder ve son imajda kirik kalirdi). Ayar yalnizca bu komut icindir.
RUN pnpm --config.node-linker=hoisted deploy --filter=@getir/risk-service --prod /app

# ---------------------------------------------------------------------------
# 3) runner - calisma zamani; derleme araclari (buf, kaynak, devDeps) YOK
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app ./

# NON-ROOT: node imaji "node" kullanicisini hazir getirir. Konteyner root
# calisirsa, imajdaki bir acik dogrudan host'a dogru genisler.
USER node

EXPOSE 50055

# Saglik kontrolu servisin KENDI health RPC'sini cagirir (grpc.health.v1).
# start-period: acilis (port baglama) icin pay; bu sure icindeki basarisizlik
# konteyneri "unhealthy" yapmaz.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
