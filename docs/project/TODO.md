Current: HireMeOps / gargalos concretos identificados / atacar N+1, índices compostos, contenção SQLite e payload antes de microtuning

Sim. Fui além dos logs e conferi o código atual. Há otimizações de nível sênior bem mais relevantes do que simplesmente “colocar Full-Text Search”.

Hoje o HireMeOps já está em **SQLx 0.9**, e o SQLite está configurado com `WAL`, `synchronous=NORMAL`, `busy_timeout=5s` e pool de 5 conexões.   A versão estável atual do SQLite em 27 de agosto de 2026 é **3.53.4**, lançada em 24 de julho; a série 3.53 também corrigiu um bug importante de WAL-reset. Vale registrar `SELECT sqlite_version()` no startup para saber qual versão efetivamente está embutida/linkada pelo build. ([SQLite][1])

## Os maiores gargalos que encontrei

| Prioridade | Gargalo atual                                               |          Impacto provável |
| ---------- | ----------------------------------------------------------- | ------------------------: |
| 🔴 P0      | N+1 na busca FTS                                            |                Muito alto |
| 🔴 P0      | `list_job_posts` traz até 1.000/10.000 descrições completas |                Muito alto |
| 🔴 P0      | `run_search` faz scoring serial com várias queries por vaga |                Muito alto |
| 🔴 P0      | provável contenção/espera SQLite                            |     Muito alto no p95/p99 |
| 🟠 P1      | índices compostos não alinhados aos `ORDER BY`              |                      Alto |
| 🟠 P1      | listagem de CV traz JSON/source_text completos              |                      Alto |
| 🟠 P1      | WAL/checkpoint sem observabilidade específica               |                Médio/alto |
| 🟡 P2      | FTS prefix search sem prefix index                          |                     Médio |
| 🟡 P2      | `PRAGMA optimize`/statistics                                |                     Médio |
| 🟡 P2      | pool/statement cache tuning                                 |                     Médio |
| 🟢 P3      | UUID/Timestamp TEXT                                         | Médio só em escala grande |
| 🟢 P3      | Rust `opt-level="s"` em release                             |                 CPU-bound |

### 1. Você já tem FTS5 — mas existe um N+1 sério

A migração já cria `job_posts_fts` como **external-content FTS5**, mantém o índice sincronizado por triggers e usa `unicode61 remove_diacritics 2`. Essa arquitetura é correta.

O problema está depois da pesquisa. Atualmente `search_job_posts()` encontra os IDs ordenados por `bm25()`, mas `list_job_posts()` faz, para cada ID:

```rust
for id in ids {
    sqlx::query_as(
        "SELECT ... FROM job_posts WHERE id = ?1"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
}
```

E o próprio código permite até **500 hits** de FTS. Isso vira:

```text
1 query FTS
+
até 500 SELECTs
=
501 round trips ao SQLite
```

O padrão está diretamente no código atual.

A versão ideal é **uma única query**:

```sql
SELECT
    jp.id,
    jp.profile_id,
    jp.platform,
    jp.external_id,
    jp.url,
    jp.canonical_url,
    jp.title,
    jp.company,
    jp.location,
    jp.remote_mode,
    jp.description,
    jp.summary,
    jp.seniority,
    jp.salary_min,
    jp.salary_max,
    jp.currency,
    jp.employment_type,
    jp.discovered_at,
    jp.status,
    jp.search_query_id,
    jp.discovery_source,
    jp.contact_email,
    bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) AS rank
FROM job_posts_fts
JOIN job_posts jp
  ON jp.rowid = job_posts_fts.rowid
WHERE job_posts_fts MATCH ?1
  AND jp.profile_id = ?2
ORDER BY rank ASC
LIMIT ?3;
```

Resultado arquitetural:

```text
antes
FTS → Vec<ID> → SELECT → SELECT → SELECT → ...

depois
FTS JOIN job_posts → Vec<JobPostDto>
```

Eu colocaria isso como **P0**.

---

## 2. O `LIMIT` padrão de 1000 está agressivo demais

O código atual faz:

```rust
let lim = limit.unwrap_or(1000).min(10000);
```

e cada linha carrega, entre outros:

```text
description
summary
url
canonical_url
company
location
...
```

Ou seja, abrir uma tela pode materializar **1.000 descrições completas de vagas**; uma chamada pode pedir **10.000**.

Eu mudaria a arquitetura para:

```text
JobListItem
    id
    title
    company
    location
    remote_mode
    salary
    status
    discovered_at
    short_summary

             ↓ click

JobDetail
    description
    summary completo
    metadata completa
    ...
```

Para UI:

```rust
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
```

Isso reduz simultaneamente:

```text
SQLite I/O
→ alocações Rust
→ UTF-8 copies
→ serde
→ IPC Tauri
→ JS allocations
→ React rendering
```

É uma melhoria end-to-end, não apenas de banco.

---

## 3. Cursor pagination em vez de OFFSET

Hoje:

```sql
ORDER BY discovered_at DESC
LIMIT ?2 OFFSET ?3
```

Quanto maior o `OFFSET`, maior o trabalho desperdiçado.

Use keyset pagination com desempate por `id`:

```sql
SELECT ...
FROM job_posts
WHERE profile_id = ?1
  AND (
        discovered_at < ?2
        OR (discovered_at = ?2 AND id < ?3)
      )
ORDER BY discovered_at DESC, id DESC
LIMIT ?4;
```

Índice:

```sql
CREATE INDEX idx_jobs_profile_discovered_id
ON job_posts(profile_id, discovered_at DESC, id DESC);
```

Assim:

```text
página 1   O(log N + K)
página 100 O(log N + K)
página 500 O(log N + K)
```

em vez de descartar milhares de linhas anteriores.

---

## 4. Os índices de `job_posts` atuais não correspondem perfeitamente às queries

O schema possui:

```sql
CREATE INDEX idx_jobs_profile_status
ON job_posts(profile_id, status);

CREATE INDEX idx_jobs_discovered
ON job_posts(discovered_at);
```

Mas a consulta problemática é:

```sql
WHERE profile_id = ?
ORDER BY discovered_at DESC
```

E outra é:

```sql
WHERE profile_id = ?
  AND status = ?
ORDER BY discovered_at DESC
```

O SQLite consegue usar índices existentes parcialmente, mas ainda pode ter de ordenar os resultados. O Query Planner consegue eliminar busca + sort quando a ordem do índice corresponde adequadamente aos filtros e ao `ORDER BY`.  ([SQLite][2])

Eu criaria:

```sql
CREATE INDEX idx_jobs_profile_discovered
ON job_posts(profile_id, discovered_at DESC);

CREATE INDEX idx_jobs_profile_status_discovered
ON job_posts(profile_id, status, discovered_at DESC);
```

Depois:

```sql
EXPLAIN QUERY PLAN
SELECT ...
FROM job_posts
WHERE profile_id = ?
ORDER BY discovered_at DESC
LIMIT 50;
```

O objetivo é remover coisas como:

```text
USE TEMP B-TREE FOR ORDER BY
```

e chegar a um index scan que satisfaça filtro + ordenação.

---

## 5. Outros índices concretos que estão faltando

Há mais consultas no código que não estão alinhadas ao schema.

O `latest_analysis()` faz:

```sql
WHERE cv_document_id = ?
ORDER BY created_at DESC
LIMIT 1
```

mas o índice existente está organizado por:

```sql
(profile_id, created_at)
```

Então eu adicionaria:

```sql
CREATE INDEX idx_cv_analysis_document_created
ON cv_analysis_reports(cv_document_id, created_at DESC);
```

A seleção da preferência mais recente faz:

```sql
WHERE profile_id = ?
ORDER BY updated_at DESC
LIMIT 1
```

então:

```sql
CREATE INDEX idx_job_preferences_profile_updated
ON job_preferences(profile_id, updated_at DESC);
```

A listagem de variants dos logs faz:

```sql
WHERE profile_id = ?
ORDER BY created_at DESC
```

então:

```sql
CREATE INDEX idx_profile_variants_profile_created
ON profile_variants(profile_id, created_at DESC);
```

E `run_search()` busca:

```sql
WHERE search_query_id = ?
  AND status = 'discovered'
ORDER BY discovered_at ASC
```

Eu usaria inclusive um **partial index**:

```sql
CREATE INDEX idx_jobs_search_discovered
ON job_posts(search_query_id, discovered_at ASC)
WHERE status = 'discovered';
```

Partial indexes são particularmente bons aqui porque reduzem o tamanho do índice e o custo de manutenção para um conjunto “hot” específico. ([SQLite][3])

---

## 6. Não crie outro índice para `cv_rewrites`

Aqui há uma correção importante em relação à hipótese inicial.

O schema já possui:

```sql
CREATE INDEX idx_cv_rewrites_profile_created
ON cv_rewrites(profile_id, created_at);
```

E SQLite consegue percorrer um índice de trás para frente para `ORDER BY ... DESC`; não precisa criar outro índice idêntico apenas acrescentando `DESC`.

Portanto:

```text
41 rows
2.37 segundos
```

não é explicado por ausência de `(profile_id, created_at)`.

Esse dado aumenta bastante minha suspeita de:

```text
lock/contention
+
payload grande
+
I/O
+
query duplicada
```

---

## 7. O log das duas queries idênticas é extremamente suspeito

Você mostrou:

```text
12:03:01.427854
elapsed=2.372728208

12:03:01.427870
elapsed=2.372948301
```

Mesma SQL, praticamente mesmo início, praticamente mesmo fim.

Isso se parece muito mais com:

```text
request A ─────┐
               ├─ espera evento comum ───── completa
request B ─────┘
```

do que com duas queries CPU-bound independentemente lentas.

Pode ser:

```text
writer lock
checkpoint
pool saturation
I/O stall
React duplicate request
mesma tela requisitando o mesmo recurso em dois lugares
```

E o `busy_timeout(5s)` atual permite justamente esperar por lock em vez de imediatamente retornar `SQLITE_BUSY`.

---

## 8. Instrumente o **pool**, não apenas as queries

SQLx 0.9 tem suporte nativo para medir tempo de aquisição de conexão:

```rust
SqlitePoolOptions::new()
    .max_connections(5)
    .acquire_time_level(tracing::log::LevelFilter::DEBUG)
    .acquire_slow_threshold(Duration::from_millis(50))
    .acquire_slow_level(tracing::log::LevelFilter::WARN)
```

A API atual expõe `acquire_time_level`, `acquire_slow_level` e `acquire_slow_threshold`. ([Docs.rs][4])

O que você quer distinguir é:

```text
REQUEST
  │
  ├── pool_wait = 1430 ms  ← problema de concorrência
  │
  └── sqlite_exec = 4 ms
```

versus:

```text
REQUEST
  │
  ├── pool_wait = 0.2 ms
  │
  └── sqlite_exec = 1430 ms ← planner/I/O/query
```

Sem essa divisão, um WARN de 1,4 s pode induzir a otimizar a SQL errada.

---

## 9. Eu consideraria um single-writer actor

WAL permite readers e writer simultaneamente, mas SQLite continua permitindo **somente um writer por vez**. ([SQLite][5])

O HireMeOps tem potencialmente:

```text
scraper
AI scoring
application worker
CV rewrite
settings
UI
background automation
```

todos persistindo coisas.

Em vez de vários tasks brigarem para escrever:

```text
task A ─┐
task B ─┤
task C ─┼── SQLite write lock
task D ─┘
```

um design muito sólido para desktop local-first é:

```text
                    ┌─ read connection
UI/readers ─────────┼─ read connection
                    └─ read connection

writes ─→ bounded mpsc ─→ DB writer ─→ SQLite
```

O writer pode ainda juntar pequenos writes em micro-batches.

Isso tende a dar uma melhora especialmente forte de **p95/p99**, mesmo quando throughput médio já parece aceitável.

---

## 10. Batch de inserts é muito mais importante que aumentar o pool

Hoje `ingest_job_post()` executa uma vaga por chamada e faz um `INSERT` individual. O FTS trigger também atualiza seu índice a cada inserção.

Para scraping em lote:

```rust
BEGIN IMMEDIATE;

INSERT job 1;
INSERT job 2;
INSERT job 3;
...
INSERT job 100;

COMMIT;
```

melhor do que:

```text
BEGIN → 1 → COMMIT
BEGIN → 2 → COMMIT
BEGIN → 3 → COMMIT
...
```

Eu testaria batches de:

```text
50
100
250
```

e escolheria por benchmark.

Não faria transações gigantescas de milhares de vagas, porque WAL muito grande também tem custo.

---

## 11. `run_search()` tem outro N+1 arquitetural

Hoje:

```rust
for job_id in &job_ids {
    self.score_match(...).await?;
}
```

E `score_match()` busca novamente coisas como:

```text
job
preference
profile_variants
```

por vaga.

Para 1.000 vagas você termina repetindo informações praticamente imutáveis 1.000 vezes.

O fluxo sênior seria:

```text
1 query → preference
1 query → variants
1 query → 100/250 jobs

              ↓

       scoring em memória
       potencialmente paralelo

              ↓

1 transação
  batch INSERT job_matches
  batch UPDATE job_posts
```

A arquitetura passa de aproximadamente:

```text
O(N × queries auxiliares)
```

para:

```text
O(queries fixas + N CPU + batch write)
```

Esse provavelmente será um dos maiores ganhos do projeto inteiro.

---

## 12. Separe `CvRewriteSummary` de `CvRewriteDetail`

Seu `CvRewriteReport` carrega:

```text
rewrite
metadata
source_text
```

e a query dos logs seleciona:

```text
rewrite_json
metadata_json
source_text
```

para **todos os 41 rewrites**.

O modelo atual confirma que a estrutura da listagem contém todo esse conteúdo.

Eu criaria:

```rust
struct CvRewriteSummary {
    id,
    cv_document_id,
    file_name,
    role_variant_id,
    variant_name,
    model_provider,
    model_name,
    created_at,
}
```

e:

```rust
struct CvRewriteDetail {
    summary,
    rewrite,
    metadata,
    source_text,
}
```

Então:

```sql
-- Tela
SELECT metadata leve ...
LIMIT 50;

-- Ao abrir
SELECT rewrite_json, metadata_json, source_text
FROM cv_rewrites
WHERE id = ?;
```

Isso reduz banco, Rust, serde, IPC e React ao mesmo tempo.

---

# 13. Seu FTS usa prefix search em absolutamente todos os termos

A função atual transforma termos em algo equivalente a:

```text
"rust"*
"back"*
"engin"*
```

Mas sua tabela FTS5 não declara `prefix=`.

A documentação oficial do FTS5 explica que, sem prefix indexes, buscas por prefixo exigem range scans sobre os termos; é possível adicionar índices dedicados de prefixos. ([SQLite][6])

Eu testaria uma reconstrução:

```sql
CREATE VIRTUAL TABLE job_posts_fts USING fts5(
    title,
    company,
    location,
    description,
    summary,
    content='job_posts',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3 4'
);
```

Trade-off:

```text
mais disco / writes um pouco mais caros
           ↓
prefix queries mais rápidas
```

Como o seu mecanismo transforma todo termo em prefix query, aqui faz mais sentido que numa aplicação FTS comum.

---

## 14. Debounce + mínimo de caracteres para FTS

Para busca interativa:

```text
r
ru
rus
rust
```

não deveria necessariamente gerar quatro pesquisas.

Eu usaria algo como:

```text
minimum length = 2 ou 3
debounce = 150–250 ms
cancel previous request
```

Com:

```text
AbortController / request generation ID
```

Isso evita trabalhos que serão descartados 30 ms depois pelo próximo caractere.

---

## 15. Faça manutenção do FTS depois de grandes imports

FTS5 mantém seus próprios segmentos/índices internos e possui comandos de merge/optimize. A documentação atual inclusive descreve parâmetros de merge e manutenção do índice. ([SQLite][6])

Após grandes batches — não após cada vaga — pode valer benchmarkar:

```sql
INSERT INTO job_posts_fts(job_posts_fts)
VALUES('optimize');
```

Algo como:

```text
bulk import
   ↓
commit
   ↓
idle/background maintenance point
   ↓
FTS optimize
```

Não faria isso em cada startup nem em cada insert.

---

## 16. `PRAGMA optimize` deveria entrar no lifecycle

SQLite moderno recomenda `PRAGMA optimize` no lugar de executar `ANALYZE` manualmente indiscriminadamente.

Para conexões long-lived, a recomendação atual é:

```sql
PRAGMA optimize=0x10002;
```

ao abrir e posteriormente:

```sql
PRAGMA optimize;
```

periodicamente. Também é recomendado após mudanças de schema, especialmente criação de índices. Desde SQLite 3.46, o comando limita automaticamente o trabalho necessário de `ANALYZE`. ([SQLite][7])

SQLx 0.9 inclusive adiciona:

```rust
.optimize_on_close(true, None)
```

para executar `PRAGMA optimize` quando a conexão é fechada. ([Docs.rs][8])

No HireMeOps eu faria pelo menos:

```rust
run_migrations(&pool).await?;

sqlx::query("PRAGMA optimize;")
    .execute(&pool)
    .await?;
```

---

## 17. Monitore checkpoint starvation

WAL melhora muito a concorrência de leitura/escrita, mas tem uma propriedade importante: um reader antigo pode impedir o checkpoint de terminar.

Se sempre existir algum reader ativo:

```text
WAL
4 MB
8 MB
20 MB
50 MB
100 MB
...
```

A documentação oficial alerta que read performance piora à medida que o WAL cresce e descreve explicitamente **checkpoint starvation**. ([SQLite][5])

Isso conecta vários problemas atuais:

```text
SELECT até 1000 jobs
      +
description gigante
      +
longer read
      ↓
checkpoint bloqueado
      ↓
WAL cresce
      ↓
reads ficam mais caros
```

Eu registraria periodicamente:

```sql
PRAGMA wal_checkpoint(PASSIVE);
```

e tamanho físico de:

```text
hiremeops.db
hiremeops.db-wal
hiremeops.db-shm
```

`PASSIVE` é apropriado para observação/manutenção não agressiva; `FULL`, `RESTART` e `TRUNCATE` têm comportamento mais bloqueante. ([SQLite][9])

---

## 18. Não assumiria que `max_connections=5` é o ótimo

Atualmente:

```rust
.max_connections(5)
```

Com PostgreSQL, “mais conexões” frequentemente aumenta paralelismo.

Com SQLite:

```text
readers → sim
writers → exatamente 1 por vez
```

Então eu benchmarkaria:

| Pool | Expectativa                               |
| ---: | ----------------------------------------- |
|    1 | baseline, praticamente zero contention    |
|    2 | 1 writer + reader                         |
|    3 | bom candidato desktop                     |
|    4 | bastante leitura concorrente              |
|    5 | atual                                     |
|   8+ | provável ganho pequeno / contention maior |

Não estou dizendo que 5 está errado; estou dizendo que **pool size precisa ser resultado de benchmark**, não heurística de servidor SQL.

---

## 19. Statement cache do SQLx

SQLx 0.9 mantém statements preparados em LRU por conexão, com capacidade padrão de **100 statements**. ([Docs.rs][10])

O HireMeOps já tem bastante SQL estático.

Se telemetria mostrar churn no cache, você pode testar:

```rust
.statement_cache_capacity(256)
```

ou:

```rust
.statement_cache_capacity(512)
```

Mas eu classificaria como P2: eliminar 500 queries individuais dá ordens de grandeza mais retorno que aumentar statement cache.

---

## 20. `cache_size`, `mmap_size` e `temp_store`: sim, mas só depois

SQLite permite controlar page cache, memory-mapped I/O e armazenamento temporário. `mmap_size` é principalmente útil para workloads de leitura. ([SQLite][11])

Um perfil de benchmark poderia testar:

```sql
PRAGMA cache_size = -16384;       -- ~16 MiB por conexão
PRAGMA mmap_size = 134217728;     -- 128 MiB
PRAGMA temp_store = MEMORY;
```

Mas atenção a:

```text
16 MiB × 5 connections
```

e a `mmap_size` compartilhar espaço de endereçamento.

Portanto eu faria A/B benchmark:

```text
baseline
vs
16 MiB cache
vs
32 MiB cache
vs
+ mmap
```

e escolheria por p50/p95/p99 + RSS, não por “tuning recipe”.

---

## 21. `DELETE old scans` também pode melhorar

O código faz:

```sql
id NOT IN (
    SELECT job_id FROM application_runs ...
)
AND id NOT IN (
    SELECT job_id FROM application_drafts ...
)
```

Você já tem índice para `application_runs(job_id)`, mas eu verificaria/garantiria também:

```sql
CREATE INDEX idx_application_drafts_job
ON application_drafts(job_id);
```

E tenderia a escrever:

```sql
DELETE FROM job_posts AS j
WHERE j.profile_id = ?1
  AND j.discovered_at < ?2

  AND NOT EXISTS (
      SELECT 1
      FROM application_runs ar
      WHERE ar.job_id = j.id
  )

  AND NOT EXISTS (
      SELECT 1
      FROM application_drafts ad
      WHERE ad.job_id = j.id
  );
```

É mais explícito como anti-join e permite probes indexados claros.

---

# 22. Seu build release está otimizado para **tamanho**, não velocidade

Achei isto:

```toml
[profile.release]
opt-level = "s"
lto = "thin"
codegen-units = 1
strip = true
```

`"s"` significa **optimize for binary size**. O profile `release` padrão do Rust usa `opt-level=3`, voltado para otimização de runtime. ([doc.rust-lang.org][12])

Para um desktop app em que performance importa mais do que economizar alguns MB, eu criaria:

```toml
[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
strip = true
```

Ou melhor, mantenha ambos:

```toml
[profile.release]
opt-level = "s"
lto = "thin"
codegen-units = 1
strip = true

[profile.perf]
inherits = "release"
opt-level = 3
```

E benchmarke:

```bash
cargo build --profile perf
```

Isso pode ajudar scoring, JSON parsing, dedupe, matching e processamento Rust. Não vai transformar uma SQL de 2,3 s em 2 ms, então continua sendo uma otimização posterior ao banco.

---

# 23. Evolução de schema para escala grande

O schema foi projetado com **IDs UUID em `TEXT` e timestamps ISO-8601 em `TEXT`**.

Funciona perfeitamente, mas em centenas de milhares/milhões de rows:

```text
UUID TEXT ≈ 36 bytes
INTEGER PK = até 8 bytes

ISO timestamp TEXT ≈ 20–30 bytes
INTEGER unix micros = 8 bytes
```

Isso influencia:

```text
B-tree size
cache locality
index depth
foreign-key indexes
comparison CPU
disk
```

Uma eventual v2 de alta escala poderia adotar:

```sql
internal_id INTEGER PRIMARY KEY,
public_id BLOB(16) UNIQUE
```

e:

```sql
discovered_at INTEGER
```

mantendo conversão para UUID/RFC3339 na camada Rust.

Eu **não migraria agora** só por isso. N+1, query shape e contention são muito mais importantes.

---

# 24. `WITHOUT ROWID` é interessante, mas não no `job_posts` sem análise

SQLite suporta `WITHOUT ROWID`, que pode reduzir espaço e processamento quando a PK natural faz sentido. ([SQLite][13])

Mas no HireMeOps:

```text
TEXT UUID PK
+
muitos índices
+
FTS ligado ao rowid
```

torna isso uma decisão bem menos óbvia.

Especialmente `job_posts_fts` atualmente depende explicitamente:

```sql
content_rowid='rowid'
```

Então não faria uma conversão indiscriminada.

---

# Arquitetura alvo

Eu visaria isto:

```text
                    HIREMEOPS
                        │
              ┌─────────┴─────────┐
              │                   │
           READ PATH          WRITE PATH
              │                   │
       read pool 2–4         bounded queue
              │                   │
       narrow SELECTs        single writer
              │                   │
       keyset pagination     batch transaction
              │                   │
       FTS single JOIN       batch matches
              │                   │
       detail-on-demand      FTS triggers
              │                   │
              └────────┬──────────┘
                       │
                  SQLite WAL
                       │
             composite indexes
                       │
           controlled checkpoints
                       │
               PRAGMA optimize
```

E o fluxo de job search:

```text
FTS5
 │
 ├── prefix indexes
 │
 ├── bm25
 │
 └── JOIN job_posts
          │
          └── 50 lightweight rows
                    │
                    ├── UI
                    │
                    └── click → detail
```

Enquanto o scoring:

```text
load preference once
load variants once
load 100–250 jobs
       │
       ▼
CPU scoring / parallelizable
       │
       ▼
single batched transaction
       │
       ├── INSERT matches
       └── UPDATE statuses
```

## Ordem em que eu implementaria

1. **Eliminar o N+1 do FTS.**
2. **Reduzir `list_job_posts` de 1000 para ~50/100 e separar list/detail.**
3. **Adicionar `(profile_id, discovered_at)` e `(profile_id, status, discovered_at)`.**
4. **Adicionar índices para `search_query_id + discovered`, `cv_document_id + created_at`, `profile_id + updated_at`, variants e drafts/job.**
5. **Instrumentar `sqlx::pool::acquire` separadamente da execução da query.**
6. **Eliminar a chamada duplicada de `list_cv_rewrites`.**
7. **Separar `CvRewriteSummary` de `CvRewriteDetail`.**
8. **Refatorar `run_search` para preload + CPU batch + single batched write.**
9. **Medir WAL/checkpoints e implementar manutenção em momentos ociosos.**
10. **Adicionar `PRAGMA optimize` ao lifecycle.**
11. **Testar FTS `prefix='2 3 4'`.**
12. **Benchmarkar pool 2/3/4/5 conexões em vez de assumir 5.**
13. **Testar `statement_cache_capacity`, cache_size e mmap somente depois.**
14. **Trocar o profile de performance de Rust para `opt-level=3`.**
15. Só depois pensar em **INTEGER/BLOB IDs, timestamps INTEGER, PGO e mudanças profundas de schema**.

Eu esperaria que os itens **1–8** fossem capazes de mudar a sensação do HireMeOps muito mais do que qualquer `PRAGMA` isolado. E, especificamente pelos logs, **zero rows em 1,46 s + duas queries idênticas terminando quase juntas + `cv_rewrites` já corretamente indexado** faz de **contenção/pool/duplicação de requests** uma hipótese tão importante quanto o query planner. ([SQLite][5])

Posso também acompanhar esse trabalho como uma revisão recorrente de performance do HireMeOps.

[1]: https://sqlite.org/releaselog/3_53_4.html?utm_source=chatgpt.com "SQLite Release 3.53.4 On 2026-07-24"
[2]: https://www.sqlite.org/queryplanner.html?utm_source=chatgpt.com "Query Planning"
[3]: https://www.sqlite.org/partialindex.html?utm_source=chatgpt.com "Partial Indexes"
[4]: https://docs.rs/sqlx/latest/sqlx/pool/struct.PoolOptions.html?utm_source=chatgpt.com "PoolOptions in sqlx::pool - Rust"
[5]: https://www2.sqlite.org/wal.html?utm_source=chatgpt.com "Write-Ahead Logging"
[6]: https://www.sqlite.org/fts5.html?utm_source=chatgpt.com "SQLite FTS5 Extension"
[7]: https://www.sqlite.org/lang_analyze.html "ANALYZE"
[8]: https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html "SqliteConnectOptions in sqlx::sqlite - Rust"
[9]: https://www.sqlite.org/c3ref/wal_checkpoint_v2.html?utm_source=chatgpt.com "Checkpoint a database"
[10]: https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html?utm_source=chatgpt.com "SqliteConnectOptions in sqlx::sqlite - Rust"
[11]: https://www.sqlite.org/pragma.html?utm_source=chatgpt.com "Pragma statements supported by SQLite"
[12]: https://doc.rust-lang.org/cargo/reference/profiles.html?utm_source=chatgpt.com "Profiles - The Cargo Book"
[13]: https://www.sqlite.org/withoutrowid.html?utm_source=chatgpt.com "Clustered Indexes and the WITHOUT ROWID Optimization"

Current: `HireMeOps / consultas SQLite lentas / investigar índices + contenção antes de FTS`

Sim: **esses logs provam que existe um problema de performance no acesso ao banco**, mas **não provam que o problema seja “falta de Full-Text Search”**. Na verdade, pelas queries mostradas, eu suspeitaria primeiro de **índices ausentes/inadequados, contenção/locking do SQLite ou I/O**, porque os tempos estão muito altos para a quantidade de dados retornada.

Veja este caso:

```sql
SELECT ...
FROM cv_rewrites r
LEFT JOIN cv_documents d ON d.id = r.cv_document_id
LEFT JOIN profile_variants v ON v.id = r.role_variant_id
WHERE r.profile_id = ?1
ORDER BY r.created_at DESC
```

Retorna somente:

```text
rows_returned=41
elapsed=2.372s
```

**2,37 segundos para 41 registros é anormal** em um SQLite local. Mesmo com JSONs relativamente grandes, eu esperaria normalmente dezenas de milissegundos ou menos em uma máquina desktop, salvo I/O pesado ou contenção.

E pior ainda:

```sql
SELECT ...
FROM job_posts
WHERE profile_id = ?1
ORDER BY discovered_at DESC
LIMIT ?2 OFFSET ?3
```

Retornou:

```text
rows_returned=0
elapsed=1.466s
```

Zero resultados demorando **1,46 s** é um indício especialmente forte de que o SQLite está fazendo trabalho desnecessário ou esperando alguma coisa.

### O que eu corrigiria primeiro

Para essas queries, os índices importantes seriam compostos:

```sql
CREATE INDEX IF NOT EXISTS idx_job_posts_profile_discovered
ON job_posts(profile_id, discovered_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_variants_profile_created
ON profile_variants(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cv_rewrites_profile_created
ON cv_rewrites(profile_id, created_at DESC);
```

Além dos índices das FKs usadas nos joins:

```sql
CREATE INDEX IF NOT EXISTS idx_cv_rewrites_document
ON cv_rewrites(cv_document_id);

CREATE INDEX IF NOT EXISTS idx_cv_rewrites_role_variant
ON cv_rewrites(role_variant_id);
```

`id` de `cv_documents` e `profile_variants` provavelmente já é `PRIMARY KEY`, portanto esses dois lados dos joins já estarão indexados.

O primeiro índice é particularmente importante porque transforma:

```sql
WHERE profile_id = ?
ORDER BY discovered_at DESC
LIMIT ?
```

em praticamente o cenário ideal para B-tree: SQLite localiza o `profile_id` e já percorre os registros **na ordem desejada**, sem precisar buscar tudo e depois executar temporary sort.

Faça:

```sql
EXPLAIN QUERY PLAN
SELECT id, profile_id, platform, external_id,
       url, canonical_url, title, company,
       location, remote_mode, description, summary,
       seniority, salary_min, salary_max, currency,
       employment_type, discovered_at, status,
       search_query_id, discovery_source, contact_email
FROM job_posts
WHERE profile_id = 1
ORDER BY discovered_at DESC
LIMIT 50 OFFSET 0;
```

Você quer algo parecido com:

```text
SEARCH job_posts USING INDEX idx_job_posts_profile_discovered (profile_id=?)
```

e **não**:

```text
SCAN job_posts
USE TEMP B-TREE FOR ORDER BY
```

### Full-Text Search é outro problema

FTS5 faria sentido no HireMeOps para coisas como:

```text
"rust backend"
"python sql estágio"
"engenheiro software remoto"
```

pesquisando:

```text
title
company
description
summary
location
```

Por exemplo:

```sql
CREATE VIRTUAL TABLE job_posts_fts USING fts5(
    title,
    company,
    description,
    summary,
    content='job_posts',
    content_rowid='id'
);
```

Então:

```sql
SELECT j.*
FROM job_posts_fts f
JOIN job_posts j ON j.id = f.rowid
WHERE job_posts_fts MATCH 'rust AND backend'
ORDER BY bm25(job_posts_fts)
LIMIT 50;
```

Isso é muito melhor do que:

```sql
WHERE description LIKE '%rust%'
   OR title LIKE '%rust%'
   OR summary LIKE '%rust%'
```

Mas **FTS não ajudaria diretamente nas três queries do log que você mostrou**, porque elas nem estão fazendo busca textual.

### Tem outro sinal importante no seu log

Esta consulta aparece duas vezes no **mesmo timestamp**:

```text
12:03:01.427854
12:03:01.427870
```

com essencialmente a mesma duração:

```text
2.372728208s
2.372948301s
```

e exatamente a mesma SQL.

Isso merece investigação. Pode existir chamada duplicada no frontend/backend, por exemplo:

```text
React component
    ↓
useEffect()
    ↓
invoke("list_cv_rewrites")
    ↓
duas execuções
```

ou duas partes da UI requisitando a mesma coleção simultaneamente.

Se você estiver em React dev com `StrictMode`, também vale verificar se algum efeito está gerando chamadas duplicadas.

Então temos potencialmente:

```text
UI
 ├── query rewrites ──┐
 └── query rewrites ──┤
                      ↓
                  SQLite
```

quando deveria existir uma única aquisição/cache:

```text
UI
      ↓
repository/store
      ↓
   SQLite
```

### E existe uma terceira possibilidade ainda mais relevante: SQLite bloqueado

Uma consulta simples que retorna zero linhas levando **1,4 s** pode significar que o tempo registrado pelo SQLx inclui espera por banco/conexão.

Eu verificaria:

```sql
PRAGMA journal_mode;
PRAGMA synchronous;
PRAGMA busy_timeout;
```

Para aplicativo desktop com leituras concorrentes, normalmente queremos considerar:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

WAL é especialmente relevante no HireMeOps porque você tem vários produtores/consumidores:

```text
job discovery
browser automation
AI analysis
CV rewriting
UI
background tasks
        ↓
      SQLite
```

Sem uma arquitetura de acesso adequada, uma escrita pode prejudicar leituras concorrentes.

Também procure transações exageradamente longas, como:

```rust
let mut tx = pool.begin().await?;

// chamada HTTP
// chamada de IA
// processamento pesado
// browser automation

sqlx::query(...).execute(&mut *tx).await?;

tx.commit().await?;
```

Isso seria ruim.

O ideal é:

```rust
// processamento externo primeiro

let result = expensive_work().await?;

// somente então:
let mut tx = pool.begin().await?;
persist(&mut tx, result).await?;
tx.commit().await?;
```

A transação deve ocupar o banco pelo menor período possível.

### Há ainda um problema no desenho dessas leituras

Esta:

```sql
SELECT
    r.model_provider,
    r.model_name,
    r.rewrite_json,
    r.metadata_json,
    r.source_text,
    ...
FROM cv_rewrites
WHERE ...
```

está carregando `rewrite_json` e principalmente `source_text` de **todos os 41 rewrites** só para listar o histórico.

Se `source_text` contém CV inteiro e `rewrite_json` é grande, sua página de histórico pode estar carregando centenas de KB ou vários MB desnecessariamente.

Eu faria dois endpoints/queries.

Listagem:

```sql
SELECT
    r.id,
    r.cv_document_id,
    d.file_name,
    r.role_variant_id,
    v.name,
    r.model_provider,
    r.model_name,
    r.created_at
FROM cv_rewrites r
LEFT JOIN cv_documents d ON d.id = r.cv_document_id
LEFT JOIN profile_variants v ON v.id = r.role_variant_id
WHERE r.profile_id = ?1
ORDER BY r.created_at DESC
LIMIT ?2;
```

Detalhe somente quando o usuário abrir um rewrite:

```sql
SELECT
    rewrite_json,
    metadata_json,
    source_text
FROM cv_rewrites
WHERE id = ?1;
```

Isso é um padrão bem melhor:

```text
LIST
id/name/model/date
        │
        └── usuário abre
                ↓
DETAIL
rewrite_json/source_text/metadata
```

### Minha prioridade para o HireMeOps seria

1. Rodar `EXPLAIN QUERY PLAN` nessas três queries.
2. Criar os índices compostos `(profile_id, timestamp DESC)`.
3. Confirmar `WAL`.
4. Procurar transações longas.
5. Descobrir por que `cv_rewrites` está sendo consultado duas vezes simultaneamente.
6. Não carregar `source_text`/JSONs grandes na listagem.
7. Trocar paginação crescente com `OFFSET` por **keyset/cursor pagination** quando `job_posts` crescer.
8. Só então implementar **FTS5** para a busca textual real de vagas.

Para paginação, inclusive, isto:

```sql
LIMIT 50 OFFSET 50000
```

fica progressivamente caro.

Prefira:

```sql
SELECT ...
FROM job_posts
WHERE profile_id = ?1
  AND discovered_at < ?2
ORDER BY discovered_at DESC
LIMIT 50;
```

com:

```sql
(profile_id, discovered_at DESC)
```

Aí o custo permanece quase constante mesmo com centenas de milhares de vagas.

**Portanto: sim, eu trataria esses WARNs como um problema real de arquitetura/performance de persistence. Mas não atacaria com FTS primeiro.** Pelos logs, o maior cheiro é `indexing + query shape + duplicate queries + SQLite contention/I/O`. FTS5 deve entrar separadamente para a busca textual de `title/description/summary/company`, onde realmente oferece ganho enorme.
