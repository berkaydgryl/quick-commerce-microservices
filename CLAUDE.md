# CLAUDE.md

Bu dosya, AI asistanlarinin her oturumda okumasi gereken kisa giristir.

## Tek dogru kaynak

- **Proje kurallari:** `.cursor/rules/proje-kurallari.mdc` — calisma bicimi, git, mimari
  degismezler, SRP, TypeScript, Node.js, Go, API/gRPC, Redis, Docker, veritabani, guvenlik,
  gozlemlenebilirlik, test ve ortam. Her ise baslamadan once okunur.
- **Gorev panosu ve mimari:** `docs/roadmap.md` — gorev kimligi `T<gun>.<no>`.
- **Mimari kararlar:** `docs/adr/`. Bir karara aykiri is yapilmaz; gerekirse yeni ADR onerilir.

Kurallar bu dosyada TEKRAR EDILMEZ; iki yerde duran kural, bir gun birbirinden ayrilir.

## Global Senior Architecture & Tech Stack Rules

- **SRP & Architecture:** Strictly enforce Single Responsibility Principle. Never mix
  Controller, Service, and Repository layers in a single file or function. Functions must do
  ONE thing only.
- **TypeScript:** NO `any` allowed. Use `unknown` with runtime type checking (Zod). Ensure
  strict null checks.
- **Node.js/JS:** Never block the event loop. Always implement graceful shutdown handlers for
  services. Remove every listener you add.
- **Go:** Check every error explicitly. Pass `context.Context` as the first parameter to
  DB/I/O calls. Prevent goroutine leaks.
- **API & gRPC:** Enforce input validation, cursor pagination, structured JSON errors, and
  backward-compatible proto definitions.
- **Redis:** Always set TTL on keys (the only exceptions are documented in ADR-03). Use key
  namespaces (`app:module:id`). Never execute `KEYS *` in production.
- **Docker:** Use multi-stage builds, non-root users (`USER node`), and minimal base images.
- **Database:** Avoid N+1 queries. Always use explicit migrations. Prefer soft deletes for
  business-critical entities.
- **Security & Logs:** Zero hardcoded secrets. Mask sensitive PII data in logs. Output
  structured JSON logs with Correlation/Trace IDs.
- **Testing & Git:** Write deterministic unit and integration tests. Follow Conventional
  Commits (`feat:`, `fix:`, `refactor:`).

Her kuralin bu repodaki karsiligi (hangi dosya, hangi ADR, hangi istisna) icin bkz.
`.cursor/rules/proje-kurallari.mdc`. Ozellikle **Redis TTL istisnasi** oraya gerekcesiyle
yazilmistir: stok sayaci ve rezervasyon indeksi bilincli olarak TTL'sizdir (ADR-03).

## Kapilar

```bash
pnpm verify     # lint + format + typecheck + build + birim testleri (CI ile ayni)
pnpm test:int   # Testcontainers ile Mongo/Redis entegrasyon testleri (Docker gerekir)
```

Gorev bitince `pnpm verify` yesil olmadan is bitmis sayilmaz.
