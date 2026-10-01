#!/usr/bin/env bash
# Yerel Mongo'nun acilisi (D14, ADR-05): kimlik dogrulamali tek dugumlu replica set.
#
# Kullanicilar kok .env'den gelir (compose `env_file`):
#   MONGO_ROOT_USERNAME / MONGO_ROOT_PASSWORD -> imajin MONGO_INITDB_ROOT_* degiskenleri
#   <SERVIS>_MONGO_URI / <SERVIS>_MONGO_DB    -> init/service-users.js (yalnizca ilk acilis)
#
# Replica set kimlik dogrulamayla calisirken uyeler birbirini anahtar dosyasiyla
# (keyFile) tanir; Mongo bu dosya olmadan acilmaz. Tek dugum oldugu icin anahtar
# her acilista yeniden uretilir: dogrulanacak baska uye yok, saklamaya gerek yok.
set -euo pipefail

: "${MONGO_ROOT_USERNAME:?kok .env dosyasinda MONGO_ROOT_USERNAME yok (.env.example)}"
: "${MONGO_ROOT_PASSWORD:?kok .env dosyasinda MONGO_ROOT_PASSWORD yok (.env.example)}"
export MONGO_INITDB_ROOT_USERNAME="$MONGO_ROOT_USERNAME"
export MONGO_INITDB_ROOT_PASSWORD="$MONGO_ROOT_PASSWORD"

key_file=/etc/mongo-key/keyfile
mkdir -p "$(dirname "$key_file")"
head -c 756 /dev/urandom | base64 > "$key_file"
chmod 400 "$key_file"
chown mongodb:mongodb "$key_file"

# Imajin kendi giris betigi: ilk acilista kok kullaniciyi ve init betiklerini
# kimlik dogrulamasiz gecici bir surecte calistirir, sonra mongod'u baslatir.
exec docker-entrypoint.sh "$@" --keyFile "$key_file"
