# CLAUDE.md

Bu dosya, AI asistanlarinin her oturumda okumasi gereken kisa giristir.

## Tek dogru kaynak

- **Proje kurallari:** `.cursor/rules/proje-kurallari.mdc` (calisma bicimi, git, mimari
  degismezler, tek sorumluluk/SRP, kod kurallari, ortam). Her ise baslamadan once okunur.
- **Gorev panosu ve mimari:** `docs/roadmap.md` — gorev kimligi `T<gun>.<no>`.
- **Mimari kararlar:** `docs/adr/`. Bir karara aykiri is yapilmaz; gerekirse yeni ADR onerilir.

Kurallar bu dosyada TEKRAR EDILMEZ; iki yerde duran kural, bir gun birbirinden ayrilir.

## Architectural & SRP Rules

- Always enforce Single Responsibility Principle (SRP).
- Strictly separate Controller, Service, and Repository layers into dedicated files/modules.
- Functions must do ONE thing only. Avoid side effects in getter/read functions.
- If a generated code mixes database operations, business logic, and I/O in one place,
  automatically refactor it into proper layers.

Katman tablosu ve "sorumluluk karmasasi" isaretleri icin bkz.
`.cursor/rules/proje-kurallari.mdc` → "Tek sorumluluk (SRP)".

## Kapilar

```bash
pnpm verify     # lint + format + typecheck + build + birim testleri (CI ile ayni)
pnpm test:int   # Testcontainers ile Mongo/Redis entegrasyon testleri (Docker gerekir)
```

Gorev bitince `pnpm verify` yesil olmadan is bitmis sayilmaz.
