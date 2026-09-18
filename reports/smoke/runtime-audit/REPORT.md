# Auditoria Docker × Northflank — 2026-09-18

## Estado

Correções de launch e diagnóstico verificadas. **Bootstrap LinkedIn no nf-compute-20 continua falhando; tarefa de confiabilidade em produção não concluída.**

Inspeção começou em `010b6eed811d540b549719a06ea0965df01d04d3`, develop limpo.
Durante o trabalho apareceu commit externo `2ab2e70`, incorporando correções e artefatos em andamento. O agente não executou commit/push.

## Confirmado

1. **Docker local não impõe a quota configurada.** Calibração isolada: cpu.max `20000 100000`, memory.max `512000000`, 5.000 s wall, 4.936 s de CPU do processo, 1 período e 0 throttled. Repetições deram 4.976/4.978 s CPU em 5 s. Esse ambiente fornece ~0.99 CPU ao teste, não 0.2. Host: sched_ext ativo, `lavd_1.1.3_x86_64_unknown_linux_gnu`, kernel `7.2.3-arch1-3`. Não houve alteração do scheduler. A documentação do [kernel](https://docs.kernel.org/scheduler/sched-ext.html#scheduler-dependent-knobs) explica que BPF schedulers podem ignorar controles de CPU. A atribuição específica ao lavd permanece inferência; a falta de enforcement foi medida diretamente.
2. **Switch de background networking removia somente args customizados.** Patchright 1.63.0 adicionava `--disable-background-networking` nos defaults. Corrigido `ignoreDefaultArgs` em ambos os launch paths cloud. Default/local preservados. `/proc` confirmou flag presente com `0`, ausente com `1`; Chromium `153.0.8010.47`.
3. **Telemetria confundia headers com download concluído.** Agora mantém pending até `requestfinished` ou `requestfailed`, registra `finishedRequestsByType` e fase `awaiting_headers`/`downloading`. Sem URL completa, headers, cookies ou bodies. Contrato do [Playwright](https://playwright.dev/docs/api/class-request).
4. **Memória dos benchmarks não era igual à produção.** Defaults passaram de `512m` para `512000000` bytes = 488.28125 MiB. `488300k` resulta em ~476.9 MiB, não 488.3 MiB.

## Viewport

`innerWidth/innerHeight` verificados com Chromium real para 800×600, 900×675 e 1024×768, nas duas funções de launch e com switch 0/1. Todos corretos.
Fixture LinkedIn extraiu um card com campos válidos em cada viewport:

| Viewport | Duração total fixture | Peak cgroup | Resultado |
|---|---:|---:|---|
| 800×600 | 777.1 ms | 150.9 MiB | PASS |
| 900×675 | 738.4 ms | 148.8 MiB | PASS |
| 1024×768 | 754.4 ms | 151.1 MiB | PASS |

Isso testa selectors/lifecycle, não responsividade de todas as variantes reais do LinkedIn nem performance sob 0.2 CPU. Default mantido em 800×600. Northflank confirmou esse viewport real no probe inicial.

## Runs Northflank executados

Mesma imagem implantada `010b6ee`, Chromium153, nf-compute-20, quota0.2, memory.max488.3MiB, routing OFF. Correções locais e instrumentação `/proc` foram montadas somente nos runs via runtimeFiles; não foi alterado o Job permanente. A API documenta [overrides por run](https://northflank.com/docs/v1/api/project/jobs/run-job). Sessão válida existente; plano da busca anterior reutilizado. Novo search_run para cada execução. Secrets permaneceram no fluxo existente.

| Experimento | Search run | Northflank run | Resultado / contagens |
|---|---|---|---|
| Flag realmente removida; inspector3s | fe44283d-7815-4155-93b5-a2adb6a59d3c | 6e58ce1a-703a-496b-a9f6-f5872828c751 | failed, linkedin_renderer_unresponsive, 0/0 |
| Inspector usa restante da mesma deadline30s | 8117f458-e3d6-423d-84dc-cb05f4528227 | 46168339-7f66-4cf0-bc0a-3a64cdbf2631 | failed, linkedin_bootstrap_stalled, 0/0 |

Primeiro run: attempts18.157/16.593s, **12 scripts baixados completamente** em cada attempt; zero XHR/fetch. CPU7.676s em38.589s wall =0.199 CPU; 384/385 períodos throttled; memory.events.max +7787; pre-close workingSet363.2MiB.

Segundo run: attempt1 chegou à deadline em30.100s, 12 scripts completamente baixados; attempt2 stalled em12.805s, 3 scripts terminados e um pendente. Operação total77.884s incluindo navegação, checkpoints e cleanup entre attempts; CPU15.561s =0.200 CPU; 778/779 períodos throttled; memory.events.max +43627; pre-close workingSet408.3MiB. Deadline semântica não é deadline da operação inteira.

Ambos: guardReason=null, OOM0, OOMKi  Northflank ainda falha. Executei dois runs reais: ambos sem OOM, mas sem vagas. Num deles, os 12 scripts terminaram o download; bootstrap continuou parado com CPU saturada. Experimento de espera adicional não resolveu e foi descartado.ll0; jobs concluídos no Northflank, nenhuma execução deixada ativa. Experimento de deadline **não incorporado ao worker**. Duas submissões diagnósticas anteriores foram rejeitadas HTTP400 pelo formato runtimeFiles; respectivos search_runs marcados failed, nenhum worker iniciado nessas submissões.

## Interpretação

O A/B anterior da flag não era válido. O novo A/B removeu a flag de verdade e continuou falhando: ausência dela não é solução demonstrada.
O viewport não explica esse failure. No primeiro run não houve asset aguardando headers ou download: o browser não chegou ao bootstrap de APIs após baixar scripts. CPU rigidamente saturada e reclaim permanecem fatores fortes. Esses dados não identificam qual função JS/subsistema consome o orçamento e não provam que um plano maior resolveria todos os casos.
Mais espera não resolveu e aumentou tempo sob reclaim; não foi adotada. Não houve mudanças em auth, UA, selectors, guard, resource policy, retries, /dev/shm, compute plan ou banco/schema.
Próxima medição útil: perfil CPU do renderer/browser sob quota real, com amostras/procedimentos sanitizados. Outro smoke no Docker deste host sem calibração continua sem valor para equivalência de CPU.

## Arquivos de produto

- `automation/core/browser/browser-launch.js` + teste: switch aplicado aos defaults reais e isolamento local.
- `automation/cloud/cloud-navigation-telemetry.mjs` + teste: ciclo request→headers→finished/failed correto, cleanup.
- `automation/platforms/linkedin/worker-linkedin.js`: somente contador compacto scriptFinished.
- `scripts/benchmark/cloud-cpu-calibration.mjs` + node-test: CPU burn isolado e validação da quota fracionária.
- `scripts/benchmark/cloud-performance-docker.mjs`: calibração obrigatória, memória equivalente.
- `scripts/benchmark/cloud-viewport-matrix.mjs` + node-test: mesma calibração/memória e erro explícito.
- `docs/CLOUD_BROWSER.md`: semântica e limites dos testes.

## Verificação

- Baseline focado: 11 testes passaram.
- Regressões antes da correção: 5 failures, 7 pass; depois: 12/12.
- `bun run typecheck`: exit0.
- `bun run agent:typecheck`: exit0.
- `bun run lint`: exit0.
- `bun run format:check`: exit0.
- `bun run test:unit`: 393/393, 60 arquivos.
- `bun run test:mjs`: 21/21.
- `bun run test:cloud`: 18/18.
- `node scripts/quality/quality-review.mjs`: exit0 em modo padrão; relatório Lizard mantém **37 warnings preexistentes**, baseline010b6ee também37. Nenhum nos arquivos alterados. Duplicação ~1.385%, zero arquivo acima do hard limit. Não equivale a aprovação de todos os gates estritos do repo.
- Lizard focado nos arquivos alterados: nenhum warning com CCN10/length80/args6.
- `git diff --check`: exit0.
- Calibração e ambos drivers Docker: exit2 esperado, `cpu_calibration_quota_not_enforced`, sem declarar benchmark válido.
- Rust não alterado; suíte Rust não executada.

## Evidências

- `calibration.log`, `performance-gate.log`, `viewport-gate.log`
- `effective-argv-viewports.log`
- `fixture-800x600.log`, `fixture-900x675.log`, `fixture-1024x768.log`
- `northflank-networking.log`, `northflank-deadline.log`: logs cronológicos completos desses runs.
- `ab-networking-run.json`, `ab-deadline-run.json`: IDs de correlação.
- Logs de testes e `lizard-baseline.log` no mesmo diretório.
