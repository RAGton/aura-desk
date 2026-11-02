# ADR-0013: Issues do GitHub viram cards no Kanban (import one-way)

**Status:** Proposto (decisão do KORA-ARCHITECT, aguardando aprovação da Aura) **Data:** 2026-10-24 **Escopo:** SOMENTE a feature "issue → card no Kanban". Não redesenha o Kanban.

## Contexto

Requisito do dono (verbatim): *"vamos preparar issues futuras cada issue vai render um card no kanban"*.

O auradesk-core (ADR-002) não pode importar tauri, tauri-plugin-\*, rmcp "or anything OS-specific" (spec §9, linha 509). O core hoje não tem cliente HTTP nenhum — reqwest só aparece no lockfile como transitiva do próprio tauri.

O gh CLI está instalado e autenticado nesta máquina como RAGton (gh auth status → ✓ Logged in to github.com account RAGton (keyring)). O repo RAGton/aura-desk tem **0 issues** hoje (verificado via gh api repos/RAGton/aura-desk/issues → \[\]).

## Decisão

1.  **Fetcher no shell, porta no core.** trait IssueFetcher (port) em auradesk-core::domain::github; implementação real GhCliIssueFetcher em crates/auradesk/src/github.rs (shell Tauri), usando std::process::Command. O core fica 100% puro — sem std::process, sem HTTP, sem gh.

2.  **Tabela separada github_issues** (não colunas em tasks), com UNIQUE(source, external_id) como chave de idempotência.

3.  **One-way (GitHub → Kanban).** Card movido para done NÃO fecha a issue no GitHub no MVP. Ver "Fora do MVP".

4.  **Não-clobber explícito:** o re-sync atualiza title/description/tags e o source_status *guardado*, mas **nunca** sobrescreve tasks.status (a decisão do usuário no Kanban) nem tasks.priority, project_id, kanban_order, due_at, estimate_min.

## Consequências

**Positivas:**

- auradesk-core continua testável em qualquer host, sem Tauri e sem rede. Os testes do core rodam com um FakeIssueFetcher in-memory.

- Zero dependência nova. Zero token persistido. Zero atualização do audit de licenças (docs/licensing/dependency-license-audit.md) — std::process::Command é stdlib, e o gh é um binário externo, não uma dep Rust.

- Compat Windows + Linux: gh está disponível nas duas plataformas; Command é multiplataforma.

**Negativas:**

- O usuário final precisa ter o gh CLI instalado e autenticado. Erro amigável obrigatório (ver seção "Erros amigáveis").

- O gh é um binário externo: o shell auradesk passa a depender do PATH do sistema. Mitigado por detecção explícita + mensagem acionável.

- auradesk-mcp (shell MCP stdio) fica **sem** o fetcher no MVP: ele não tem std::process equivalente... (na verdade tem, mas o ADR-004 exige o core para a lógica). Ver "Fora do MVP".

## Alternativas rejeitadas

**(c) Fetcher dentro do core** — REJEITADA. Viola ADR-002/spec §9 ("anything OS-specific"). std::process::Command e qualquer cliente HTTP são OS-specific. Quebraria a testabilidade do core e tornaria o core impossível de rodar em host sem rede.

**(b) Cliente HTTP (ureq/reqwest) no shell** — REJEITADA no MVP. Exige:

1.  Dependência nova (licença MIT, mas exige atualizar o audit — restriction do brief).

2.  **Persistência ou leitura de token** — o gh auth token é a única fonte sem token persistido, mas ler o token do keyring e injetar num header HTTP significa que o segredo passa a existir em memória de processo e, AMI, seria fácil acabar logado. A regra dura do dono é: **nenhum token/secret pode ser salvo, ecoado ou reutilizado**.

3.  Header Authorization num processo HTTP = superfície de vazo muito maior que gh (que já gerencia o token no keyring do SO).

**(a) gh CLI via std::process::Command no shell** — **ESCOLHIDA**. Reaproveita a auth já existente (keyring do SO), zero dep nova, zero segredo em disco/heap do app, e o gh já é a ferramenta canônica do dono.

## Decisões de modelagem

**Idempotência:** UNIQUE(source, external_id) onde source = "github" e external_id = "owner/repo#number". Re-sync N vezes = 1 card.

**Direção do truth:**

- tasks.status → **truth do usuário** (Kanban). Nunca sobrescrito pelo sync.

- github_issues.source_status → **truth do GitHub** (open/closed).

- O sync **não** move o card. Ele atualiza apenas metadados (título, descrição, labels→tags) e grava o source_status novo.

- Consequência explícita: uma issue fechada no GitHub **não** move o card para done. O card continua onde o usuário deixou. Isso é intencional — o Kanban é o plano de trabalho do usuário; o GitHub é o rastreador upstream. A UI mostra um indicador visual "issue fechada" via badge, sem mover o card.

**Não-clobber (tabela):**

| **Campo de tasks** | **Sync pode escrever?** | **Motivo** |
|:---|:---|:---|
| title | SIM (só se task não foi editada) | ver title_locked |
| description | SIM (só se não editado) | ver title_locked |
| tags | SIM (union, nunca remove) | labels GitHub são aditivas |
| status | **NUNCA** | decisão do usuário no Kanban |
| priority | **NUNCA** | não mapeado do GitHub no MVP |
| project_id | **NUNCA** | decisão do usuário |
| kanban_order | **NUNCA** | decisão do usuário |
| due_at | **NUNCA** | GitHub não tem due date nativo |
| estimate_min | **NUNCA** | GitHub não tem estimate nativo |

O "só se não editado" é resolvido pela coluna title_locked INTEGER NOT NULL DEFAULT 0: quando o usuário edita o título/descrição do card no TaskForm, o shell marca title_locked = 1 e o sync para de reescrever título/descrição desse card. Sem isso, editar um card importado seria trabalho perdido (o próximo sync sobrescreveria).

**Tags:** labels do GitHub viram tags. Union (união), nunca subtract — remover uma label no GitHub não remove a tag no card (a tag pode ter sido adicionada pelo usuário). Para distinguir, tags importadas são prefixadas com gh: → "gh:bug". Isso evita colisão com tag manual e permite displays diferentes na UI (chip azul para gh:\*, chip neutro para manual).

## Superfície de API

Comandos IPC (shell Tauri, crates/auradesk/src/runtime.rs::ipc):

| **Comando** | **Input** | **Output** |
|:---|:---|:---|
| github_sync_issues | GithubSyncInput { project_id: Option\<String\>, label_filter: Option\<String\> } | GithubSyncSummary { created: u32, updated: u32, skipped: u32, issues: Vec\<GithubIssueLink\> } |
| github_issues_list | GithubIssueListInput { project_id: Option\<String\> } | Vec\<GithubIssueLink\> |
| github_link_task | GithubLinkInput { task_id: String, repo: String, number: i64 } | GithubIssueLink |
| github_unlink_task | GithubUnlinkInput { task_id: String } | () |
| github_check_auth | () | GithubAuthStatus { available: bool, authenticated: bool, account: Option\<String\>, message: Option\<String\> } |

Capabilities (registry, crates/auradesk-core/src/capabilities.rs): o registry está **vazio** hoje (&\[\]) e há um teste que afirma isso (capabilities_consistent.rs::registry_is_empty_in_phase_0). O registry **não** é tocado por esta feature no MVP — populá-lo exige resolver o registry de forma geral (o dispatcher MCP/Tauri que consome CapabilityHandler ainda não existe no core). Criar as capabilities só com a tabela abaixo, e o registry só quando o dispatcher existir.

| **Capability** | **kind** | **input** | **output** |
|:---|:---|:---|:---|
| github_sync_issues | Tauri | {project_id?, label_filter?} | GithubSyncSummary |
| github_issues_list | Tauri | {project_id?} | GithubIssueLink\[\] |
| github_link_task | Tauri | {task_id, repo, number} | GithubIssueLink |
| github_unlink_task | Tauri | {task_id} | null |
| github_check_auth | Tauri | {} | GithubAuthStatus |

## UX do Kanban

- Badge \#123 no card, com link para https://github.com/{owner}/{repo}/issues/{n} (target="\_blank" rel="noopener noreferrer").

- Labels GitHub como chips gh:label (visual distinto da tag manual).

- Gatilho: **botão manual** "Importar issues do GitHub" no header do Kanban (KanbanPage.tsx/KanbanBoard.tsx), ao lado do filtro de prioridade.

- **Sem polling em background.** Justificativa: (a) o brief proíbe polling; (b) gh em background é um subprocesso a cada N segundos — custo de CPU e risco de travar o rate-limit do GitHub; (c) o app já tem um RoutineRunner que faz polling de 15s para rotinas — adicionar outro loop competiria; (d) sync manual é previsível e testável, e o usuário decide quando puxar.

- Issue fechada no GitHub → badge cinza "closed" no card, **sem** mover o card.

## Configuração

Settings keys novas (adicionadas a SettingsKey — o enum é a whitelist canônica, e SettingsService::set rejeita key desconhecida):

- github.repo → string "owner/repo". Default seed "RAGton/aura-desk".

- github.project_id → string (nullable). Project do Kanban onde os cards importados caem. Default null (cabeçalho "Sem projeto").

- github.auto_import_labels → array de strings (nullable). Default null (importa todas as issues abertas).

- github.default_labels → array de strings (nullable) — labels aplicadas a todo card importado. Default null.

**Auth em runtime, sem token persistido:** o shell invoca gh auth status --hostname github.com e gh issue list --repo {owner}/{repo} --json .... O token vive **exclusivamente** no keyring do SO, gerenciado pelo próprio gh. AuraDesk nunca lê, copia, loga ou persiste o token.

**Erros amigáveis (traduzidos via i18n):**

| **Situação** | **Detecção** | **Mensagem ao usuário** |
|:---|:---|:---|
| gh não instalado | Command::new("gh").arg("--version") → NotFound | "GitHub CLI não encontrado. Instale o gh para importar issues." + link cli.github.com |
| gh não autenticado | gh auth status → exit != 0 / stderr contém "not logged" | "GitHub CLI não autenticado. Rode gh auth login." |
| repo inexistente/sem acesso | exit != 0, stderr do GraphQL | "Repositório {repo} não encontrado ou sem permissão de leitura." |
| rate limit | stderr contém "rate limit" | "Limite de requisições do GitHub atingido. Tente mais tarde." |
| gh ausente mas issue já vinculada | — | o card vinculado continua funcionando; só o sync falha |

## Fora do MVP (decisões explícitas)

1.  **Sync bidirecional** — card movido para done NÃO fecha a issue. YAGNI: fecha o loop de escrita, exige conflict resolution, e cria risco de escrita indevida no repo do dono.

2.  **Polling / sync automático em background.**

3.  **População do capabilities() registry** — o registry está vazio e o dispatcher (CapabilityHandler → Tauri/MCP) não existe. Fazer isso aqui seria refactor de arquitetura disfarçado de feature.

4.  **auradesk-mcp expõe a feature** — o shell MCP não tem std::process próprio na arquitetura atual; esperar o dispatcher de capabilities.

5.  **data_io export/import** — DataBundle ganha o campo github_issues e SCHEMA_VERSION vai de 1 para 2 (com back-compat de leitura da v1). **Incluído** porque sem isso o backup do usuário perde o vínculo issue↔task — quebra a promessa de soberania dos dados (ADR-0012 / data_io).

6.  **Milestone → project, assignee → tags, due date** — GitHub não tem due date nativo; milestone→project é speculativo demais.

7.  **Novas dependências Rust** — nenhuma.
