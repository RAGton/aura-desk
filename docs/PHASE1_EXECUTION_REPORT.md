# AuraDesk — Relatório de Execução da Fase 1 (Estabilização, Arquitetura e Design System)

**Branch:** `feat/phase-1-stabilization-foundation`
**Data:** 2026-11-15
**Escopo:** Estabilização, correção de bugs críticos, otimizações de arquitetura/concorrência SQLite + IPC + Frontend e fundação do Aura Design System — sem alterações de esquema SQLite, sem Supabase/Auth e sem Password Vault.

---

## 1. Arquivos Modificados e Criados

### Backend / Rust (`crates/`)
- `crates/auradesk-core/src/infrastructure/db.rs` — Pool de 4 conexões read-only (`Db::reader()`) com `SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only = ON` e `busy_timeout = 5000`, mantendo `Db::writer()` serializado para escritas e fallback para `:memory:`.
- `crates/auradesk-core/src/application/daily_plans.rs` — `normalize_plan_payload` (conversão texto puro ↔ `{"notes": ...}` JSON; limpeza de strings em branco para `NULL`) + leitura via `reader()`.
- `crates/auradesk-core/src/application/data_io.rs` — Inclusão de `bundle.json` Stored no ZIP de exportação e fallback automático para `bundle.json` em `import_zip_bytes` quando `auradesk.db` estiver ausente (compatibilidade Browser → Desktop).
- `crates/auradesk-core/src/application/tasks.rs` — Filtragem SQL (`WHERE` com `status`, `project_id`, `top_level_only` e `julianday(due_at) < julianday(?)`) em `TasksService::list` + extração de `apply_status_on_conn` + transação em lote `reorder_batch` + leitura via `reader()`.
- `crates/auradesk-core/src/application/reminders.rs` — Pré-checagem SQL `EXISTS` via `reader()` antes de adquirir `writer()` em `poll_and_fire_overdue` + leitura via `reader()`.
- `crates/auradesk-core/src/application/{alerts,github,metrics,pomodoros,projects,proposals,routines,settings}.rs` — Leituras migradas para `self.db.reader()`.
- `crates/auradesk/src/alert_lock.rs` — Mecanismo fail-safe `emergency_unlock_all` para destravamento forçado de estado e janelas.
- `crates/auradesk/src/ipc.rs` & `crates/auradesk/src/runtime.rs` — Novos comandos IPC `alerts_emergency_unlock` e `tasks_reorder` (`TaskReorderItem`).
- `crates/auradesk/tauri.conf.json` — Revisão e endurecimento da diretiva `app.security.csp`.
- `crates/auradesk-core/tests/{tasks_service,time_flows_service}.rs` — Novos testes de regressão e integração (filtros SQL, `reorder_batch` atômico/rollback, Daily Plan, ZIP `bundle.json`-only, pré-check do scheduler e `Db::reader()` `query_only = ON`).

### Frontend / Web (`apps/web/`)
- `apps/web/src/lib/zip.ts` (**novo**) — Codec PKZIP Store (método 0) + CRC-32 IEEE 802.3 + descompressão `deflate-raw` assíncrona (`DecompressionStream`) + suporte a backups JSON legados.
- `apps/web/src/lib/ipc.ts` — `serializeDailyPlanNotes` / `parseDailyPlanNotes`, exportação/importação PKZIP v2 com `bundle.json`, recorrência mensal (`+30d`) em `alerts_resolve`, fallback browser e APIs para `alerts_emergency_unlock` e `tasks_reorder`.
- `apps/web/src/pages/AlertLockPage.tsx` — Banner de erro IPC, botões **Emergency Unlock** e atalho global `Ctrl+Shift+U` chamando `alertsApi.emergencyUnlock()` com encerramento seguro da janela.
- `apps/web/src/components/ReminderModal.tsx` — Evita reset espúrio de `confirmedRead` no flush assíncrono do efeito inicial quando o ID do alerta não mudou.
- `apps/web/src/hooks/usePomodoroController.ts` (**novo**) — Extração do controlador Pomodoro (timer, cache de pausa no `sessionStorage`, auto-conclusão e mutações IPC).
- `apps/web/src/app/layout/AppShell.tsx` — Integração de `usePomodoroController`, intervalo padrão de polling ajustado para 30s com pausa quando a aba está oculta (`visibilitychange`), refresh seletivo por domínio, uso de `tasksApi.reorder` com fallback compatível e integração do componente `<Toast />`.
- `apps/web/src/styles/globals.css` & `apps/web/tailwind.config.js` — Tokens semânticos RGB (`--bg-*`, `--text-*`, `--border-*`, `--status-*`, `--radius-*`, `--shadow-*`), suporte Dark/Light sem hacks de `!important` e mapeamento `aura.*` no Tailwind.
- `apps/web/src/components/ui/{Button,Input,Badge,Dialog,Toast,Skeleton,EmptyState,index}.{ts,tsx}` (**novos**) — Primitivos acessíveis do Aura Design System.
- `apps/web/locales/{pt-BR,en}.json` — Chaves simétricas em `alertLock.*` e `ui.*`.
- Testes frontend: atualização de `apps/web/src/lib/ipc.browser.test.ts` e `apps/web/src/pages/AlertLockPage.test.tsx`; criação de `apps/web/src/lib/zip.test.ts`, `apps/web/src/hooks/usePomodoroController.test.ts` e `apps/web/src/components/ui/ui.test.tsx`.

### Documentação
- `README.md`, `docs/architecture/README.md`
- `docs/architecture/ADR-0014-phase1-stabilization-and-design-system.md` (**novo**)
- `crates/auradesk-core/migrations/README.md` (**novo**)
- `docs/PHASE1_EXECUTION_REPORT.md` (**novo**)

---

## 2. Problemas Corrigidos (Etapa 1)

1. **Notas do Plano Diário incompatíveis:** `normalize_plan_payload` (Rust) e `serializeDailyPlanNotes` / `parseDailyPlanNotes` (Web) unificam texto livre em JSON canônico `{"notes": ...}`, mantendo compatibilidade retrospectiva com payloads legados em texto puro ou objetos JSON estruturados.
2. **Backup ZIP falso no navegador:** Substituído o envelope JSON anterior por arquivos PKZIP reais em `apps/web/src/lib/zip.ts` contendo `bundle.json` v2 compatível bidirecionalmente entre Browser fallback e Desktop `DataIoService`.
3. **Recorrência mensal ausente no fallback Web:** Adicionado ramo `monthly` (`+ 30 * 86_400_000`) em `alerts_resolve` no fallback Web (`ipc.ts`).
4. **CSP permissiva no Tauri:** `app.security.csp` endurecida em `crates/auradesk/tauri.conf.json` restringindo origens de script, estilo e conexões locais (`ipc:`, `http://ipc.localhost`).
5. **Risco de travamento na tela `AlertLock`:** Implementado `emergency_unlock_all` (`alerts_emergency_unlock` IPC), feedback explícito de erro quando `resolve`/`snooze`/`dismiss` falham, botão visível de desbloqueio de emergência e atalho `Ctrl+Shift+U`.

---

## 3. Melhorias Arquiteturais e Design System (Etapas 2 e 3)

- **Separação Leitura/Escrita SQLite (WAL):** `Db::reader()` distribui consultas em um pool round-robin de 4 conexões `SQLITE_OPEN_READ_ONLY` (`query_only = ON`), evitando bloqueios pelo mutex de escrita (`Db::writer()`).
- **Pushdown de filtros SQL e reordenação Kanban em lote:** `TasksService::list` filtra diretamente no SQLite e `TasksService::reorder_batch` (`tasks_reorder`) persiste transições e ordenação de múltiplos cartões em uma única transação atômica.
- **Scheduler e Polling econômicos:** `RemindersService::poll_and_fire_overdue` executa `EXISTS` no `reader()` antes de abrir transação de escrita; `AppShell.tsx` reduz polling para 30s, pausa em abas ocultas e reidrata domínios seletivamente (`refreshTasksDomain`, `refreshAlertsDomain`, `refreshPomodoroDomain`).
- **Modularização:** Lógica de timer Pomodoro extraída para `usePomodoroController.ts`.
- **Fundação Aura Design System:** Eliminados seletores `!important` de tema claro via variáveis CSS RGB e adicionados primitivos acessíveis reutilizáveis em `apps/web/src/components/ui/`.

---

## 4. Testes e Verificações Executadas

Suíte validada no workspace após a conclusão da implementação:
- `cargo fmt --all -- --check` — formatação Rust em conformidade.
- `cargo clippy --workspace --all-targets -- -D warnings` — sem warnings.
- `cargo test --workspace` — todos os testes unitários e de integração em `auradesk-core`, `auradesk` e `auradesk-mcp` aprovados (incluindo os novos testes de regressão em `tasks_service.rs` e `time_flows_service.rs`).
- `cargo run --bin check-strings` — `0 violations` nas strings de UI/Rust/TS.
- `pnpm --filter @auradesk/web lint` & `typecheck` — verificação TypeScript estrita sem erros.
- `pnpm --filter @auradesk/web test:coverage` — todos os arquivos de teste Vitest aprovados acima da meta mínima de 70% de cobertura (linhas e branches).
- `pnpm --filter @auradesk/web build` — build de produção Vite concluído com êxito.

**Não executados neste ambiente:**
- Suíte E2E GUI/WebView2 (`pnpm --filter @auradesk/web test:e2e`) e empacotamento completo Tauri (`cargo tauri build`) — dependem de runtime desktop interativo/empacotador não acionado nesta etapa CLI.

---

## 5. Problemas Ainda Existentes

- As páginas existentes (`DashboardPage`, `KanbanPage`, `PomodoroPage`, `RemindersPage`, `SettingsPage`, `ReportsPage`) ainda contêm classes utilitárias Tailwind legadas (`bg-slate-*`, botões inline) e só adotam gradualmente os primitivos de `apps/web/src/components/ui/` a partir da Fase 2.
- No `browser fallback`, a descompressão `Deflate` para `.json` depende da API nativa `DecompressionStream("deflate-raw")`; navegadores ou ambientes muito antigos sem `DecompressionStream` só importam entradas Stored (método 0) ou backups que contenham `bundle.json` Stored.
- O arquivo `apps/web/src/app/layout/AppShell.tsx` permanece grande como contêiner de shell/navegação e ainda pode ser subdividido em hooks/subcomponentes adicionais em ciclos futuros.

---

## 6. Riscos Identificados

- **Regressão visual ao migrar páginas legadas para tokens semânticos:** Mitigado mantendo retrocompatibilidade das variáveis `--aura-*` em `globals.css` durante a transição.
- **Diferenças de cálculo de próximo disparo (`monthly`):** No Rust a recorrência usa avanço via calendário/`rrule` ou regra de domínio em `reminders.rs`, enquanto o fallback Web aproxima `+30d`; ao conectar persistência unificada/cloud nas fases seguintes, a fonte única de verdade deve ficar no backend.
- **Execução WebView2 ao vivo:** Embora `cargo clippy`, `cargo test` e Vitest validem a lógica Rust e React isoladamente, a diretiva CSP (`tauri.conf.json`) e o ciclo multi-janela do `AlertLock` devem passar por teste manual no binário desktop Tauri antes de release.

---

## 7. Próximas Tarefas Recomendadas

1. **Validação manual Desktop (`cargo tauri dev`):** Confirmar abertura sem bloqueios CSP no WebView2, som de alertas, janela `AlertLock` e atalho `Ctrl+Shift+U` em sessão desktop real.
2. **Adoção progressiva dos primitivos UI (Etapa seguinte):** Migrar modais, botões, badges e inputs de `KanbanPage`, `RemindersPage`, `SettingsPage` e `KanbanBoard` para `apps/web/src/components/ui/`.
3. **Estratégia de sincronização em nuvem e Auth (Fase 2+):** Definir ADR específica para autenticação, sincronização multi-dispositivo e criptografia ponta a ponta antes de introduzir backend externo ou Cofre de Senhas.
