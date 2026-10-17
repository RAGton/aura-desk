# ADR-011: IA propose/approve workflow; IA never writes to state tables directly

**Status:** Accepted
**Date:** 2026-10-17

## Context

After the 2026-10-17 critical review, the user was explicit: *"A
criação de tarefas e lembretes deve permitir aprovação antes de
persistir alterações."* The original design had `create_task` as a
direct MCP tool that mutated `tasks` immediately, which violates this
requirement.

The constraint is non-negotiable: any state change proposed by the IA
must be reviewable by the user, and the IA must NOT be able to bypass
this review even if its tool calls are valid.

## Decision

**The IA writes ONLY to the `ia_proposals` table.** It never writes
directly to `tasks`, `reminders`, `daily_plans`, or any other state
table. The "executor" tools (`create_task`, `update_task`,
`add_reminder`, etc.) are exposed only through Tauri IPC to the React
UI; the IA does not have access to them.

A **proposal** is a record in `ia_proposals` with:

- `payload` (JSON, the exact args the IA wanted to call)
- `payload_hash` (SHA-256 of `payload` at proposal time)
- `summary` (human-readable preview)
- `status` (`pending` → `approved` | `rejected` | `modified` | `expired`)
- `expires_at` (default `now + proposals.ttl_hours`)

The user reviews pending proposals in the React UI (sidebar panel,
modal, or inside the chat panel) and either approves (with optional
modifications) or rejects.

On **approve**:

1. The dispatcher re-validates `payload` against the **current**
   input schema.
2. The dispatcher recomputes `payload_hash` and verifies it matches the
   stored value. Drift means the proposal is moved to `expired` and
   `CoreError::Validation` is returned.
3. The payload is executed in a single transaction: the destination
   table is written, the proposal is updated to `status='approved'`,
   `result_ref_id` is set, and an `ia_commands` row is written.

A scheduler tick purges `pending` rows past `expires_at` (status →
`expired`).

The capability registry (`auradesk-core::capabilities`) makes this
structurally enforceable: every propose_* tool is registered with
`CapabilityKind::Mcp` and writes to `ia_proposals` only. The
Tauri-only executor tools are `CapabilityKind::Tauri`, so the MCP
dispatcher never even offers them to the IA.

## Consequences

Positive:
- The user's review requirement is structurally satisfied — the IA
  cannot mutate state without going through `ia_proposals`.
- The proposal is auditable: every step is recorded (`ia_commands`).
- The `payload_hash` check makes the system robust to schema drift:
  if a proposal sits in the queue while the schema evolves, the user
  is told the proposal is no longer valid and must be re-issued.
- The `result_ref_id` ties the proposal to the resulting entity,
  making it easy to trace "this task came from this proposal".

Negative:
- Every IA-initiated action is two round-trips (propose + approve). For
  high-frequency IA interactions (e.g., bulk plan generation), this is
  acceptable; for low-frequency high-impact actions (delete a task),
  it's a feature, not a bug.
- The user must be in front of the app to approve. There is no
  "auto-approve" mode in the MVP — every proposal waits for the user.
  (A v2 enhancement could add per-tool allow-lists for trusted
  workflows.)
- Expired proposals clutter the table if the user is away for days.
  Acceptable; we can add a "purge expired older than 30d" task in v2.
