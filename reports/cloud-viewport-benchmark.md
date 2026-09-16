# Cloud viewport benchmark

Generated: `2026-09-16T13:15:28.777021+00:00`

Controlled synthetic smoke. Docker used `--network none`; no credentials and no live portal DOM. Real portal validation remains pending.

## Matrix

| Plataforma | 1024x768 | 900x675 | 800x600 | Menor válido |
| --- | --- | --- | --- | --- |
| linkedin | PASS (156.3 MB / 2995 ms / 1 res.) | PASS (155.5 MB / 3210 ms / 1 res.) | PASS (156.8 MB / 3364 ms / 1 res.) | 800x600 |
| indeed | PASS (155.0 MB / 256 ms / 1 res.) | PASS (159.1 MB / 261 ms / 1 res.) | PASS (161.3 MB / 248 ms / 1 res.) | 800x600 |
| gupy | PASS (159.1 MB / 236 ms / 1 res.) | PASS (157.4 MB / 241 ms / 1 res.) | PASS (156.0 MB / 235 ms / 1 res.) | 800x600 |
| catho | PASS (162.5 MB / 237 ms / 1 res.) | PASS (161.0 MB / 240 ms / 1 res.) | PASS (154.7 MB / 244 ms / 1 res.) | 800x600 |
| infojobs | PASS (155.6 MB / 282 ms / 1 res.) | PASS (156.7 MB / 235 ms / 1 res.) | PASS (156.3 MB / 247 ms / 1 res.) | 800x600 |
| upwork | PASS (157.1 MB / 1760 ms / 1 res.) | PASS (154.1 MB / 1730 ms / 1 res.) | PASS (154.8 MB / 1731 ms / 1 res.) | 800x600 |
| freelas99 | PASS (154.9 MB / 225 ms / 1 res.) | PASS (158.6 MB / 225 ms / 1 res.) | PASS (156.7 MB / 225 ms / 1 res.) | 800x600 |
| programathor | PASS (155.9 MB / 226 ms / 1 res.) | PASS (156.6 MB / 221 ms / 1 res.) | PASS (155.2 MB / 220 ms / 1 res.) | 800x600 |
| geekhunter | PASS (159.7 MB / 224 ms / 1 res.) | PASS (153.5 MB / 224 ms / 1 res.) | PASS (157.7 MB / 223 ms / 1 res.) | 800x600 |

Extra allowlisted handlers:

| Plataforma | 1024x768 | 900x675 | 800x600 | Menor válido |
| --- | --- | --- | --- | --- |
| linkedin_posts | PASS (156.5 MB / 20132 ms / 1 res.) | PASS (158.3 MB / 20658 ms / 1 res.) | PASS (154.7 MB / 21206 ms / 1 res.) | 800x600 |
| google | PASS (155.7 MB / 13680 ms / 2 res.) | PASS (156.1 MB / 13642 ms / 2 res.) | PASS (152.6 MB / 13250 ms / 2 res.) | 800x600 |

## Resumo global

- Menor viewport válido na fixture: **800x600**.
- Pico máximo baseline: **162.5 MB**; em 800x600: **161.3 MB** (-1.2 MB).
- Duração média baseline: **3659.2 ms**; em 800x600: **3744.7 ms** (+2.34%).
- Plataformas quebradas em 800x600: nenhuma na fixture.
- Plataformas quebradas em 900x675: nenhuma na fixture.
- Timeout: nenhum. OOM: nenhum. Mudança responsiva: não observada na fixture.
- Default cloud de produção: **mantido em 1024x768** até smoke com sessão autenticada e DOM real.

## Métricas completas

Veja `cloud-viewport-benchmark.json` para cada stage, cgroup `memory.stat/events`, PSS por tipo Chromium, Node PSS, processos, campos e códigos.

Campos obrigatórios seguem contrato atual dos handlers. Campos ausentes por contrato estão marcados como opcionais no JSON.
