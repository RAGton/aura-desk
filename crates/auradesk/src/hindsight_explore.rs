//! Read-only exploration of the Hindsight daemon.
//!
//! The recall/bridge path in [`crate::hindsight`] only needs four endpoints.
//! This module covers the rest of the free Hindsight HTTP surface so the
//! desktop app can browse what the daemon actually stores: banks with their
//! statistics, memory units with full-text search, documents, entities, the
//! memory graph, and mental models.
//!
//! The daemon answers in snake_case and is not fully consistent: entities are
//! a comma-separated string in list responses but a JSON array in detail
//! responses, and a memory fact is called `fact_type` in lists but `type` in
//! details. Every payload therefore goes through an explicit normalizer that
//! produces the stable camelCase model the frontend consumes.

use std::collections::BTreeMap;
use std::time::Duration;

use auradesk_core::infrastructure::db::Db;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::hindsight::{
    build_client, encode_path_segment, endpoint_url, load_config, HindsightConfig,
};

/// Exploration endpoints can be slower than the recall path: a bank graph
/// with thousands of links takes a few hundred milliseconds.
const HTTP_TIMEOUT_EXPLORE: Duration = Duration::from_secs(10);

/// Upper bound for a single page of items, mirroring the daemon's own cap.
const MAX_PAGE_LIMIT: usize = 200;

/// Default page size used when the caller does not ask for one.
const DEFAULT_PAGE_LIMIT: usize = 25;

// ── Public model (camelCase for the frontend) ──────────────────────────

/// One bank of the Hindsight daemon with the headline counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightBankSummary {
    pub id: String,
    pub name: String,
    pub total_nodes: u64,
    pub total_links: u64,
    pub total_documents: u64,
}

/// Full statistics of a single bank.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightBankStats {
    pub bank_id: String,
    pub total_nodes: u64,
    pub total_links: u64,
    pub total_documents: u64,
    pub nodes_by_fact_type: BTreeMap<String, u64>,
    pub links_by_link_type: BTreeMap<String, u64>,
    pub pending_operations: u64,
    pub failed_operations: u64,
    pub pending_consolidation: u64,
    pub failed_consolidation: u64,
    pub last_consolidated_at: Option<String>,
    pub last_memory_write_at: Option<String>,
}

/// A memory unit as listed by `/memories/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMemoryItem {
    pub id: String,
    pub text: String,
    pub context: Option<String>,
    pub date: Option<String>,
    pub fact_type: Option<String>,
    pub document_id: Option<String>,
    pub mentioned_at: Option<String>,
    pub occurred_start: Option<String>,
    pub occurred_end: Option<String>,
    pub entities: Vec<String>,
    pub tags: Vec<String>,
    pub chunk_id: Option<String>,
    pub proof_count: u64,
    pub state: Option<String>,
}

/// A page of memory units.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMemoryPage {
    pub items: Vec<HindsightMemoryItem>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

/// A memory unit with the relations that back it up.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMemoryDetail {
    pub id: String,
    pub text: String,
    pub context: Option<String>,
    pub date: Option<String>,
    pub fact_type: Option<String>,
    pub document_id: Option<String>,
    pub mentioned_at: Option<String>,
    pub occurred_start: Option<String>,
    pub occurred_end: Option<String>,
    pub entities: Vec<String>,
    pub tags: Vec<String>,
    pub chunk_id: Option<String>,
    pub state: Option<String>,
    pub source_memory_ids: Vec<String>,
    pub source_memories: Vec<HindsightMemoryItem>,
    pub history: Vec<HindsightMemoryHistoryEntry>,
}

/// One revision of a memory unit. The daemon does not document the history
/// payload, so the raw entry is preserved next to the fields we know.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMemoryHistoryEntry {
    pub id: Option<String>,
    pub text: Option<String>,
    pub changed_at: Option<String>,
    pub created_at: Option<String>,
    pub occurred_at: Option<String>,
    pub action: Option<String>,
    pub raw: Value,
}

/// A stored document as listed by `/documents`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightDocumentItem {
    pub id: String,
    pub bank_id: Option<String>,
    pub content_hash: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub text_length: u64,
    pub memory_unit_count: u64,
    pub context: Option<String>,
    pub tags: Vec<String>,
}

/// A page of documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightDocumentPage {
    pub items: Vec<HindsightDocumentItem>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

/// A document with its original text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightDocumentDetail {
    pub id: String,
    pub bank_id: Option<String>,
    pub original_text: Option<String>,
    pub content_hash: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub memory_unit_count: u64,
    pub nodes_by_fact_type: BTreeMap<String, u64>,
    pub tags: Vec<String>,
    pub context: Option<String>,
    pub metadata: Value,
}

/// An entity as listed by `/entities`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightEntityItem {
    pub id: String,
    pub canonical_name: String,
    pub mention_count: u64,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
}

/// A page of entities.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightEntityPage {
    pub items: Vec<HindsightEntityItem>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

/// An entity with the observations that mention it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightEntityDetail {
    pub id: String,
    pub canonical_name: String,
    pub mention_count: u64,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub observations: Vec<HindsightEntityObservation>,
}

/// One observation extracted from a document that mentions an entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightEntityObservation {
    pub text: String,
    pub mentioned_at: Option<String>,
}

/// A node of the memory graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGraphNode {
    pub id: String,
    pub label: String,
    pub text: String,
    pub date: Option<String>,
    pub context: Option<String>,
    pub entities: Vec<String>,
    pub color: Option<String>,
}

/// An edge of the memory graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub link_type: Option<String>,
    pub weight: Option<f64>,
    pub entity_name: Option<String>,
    pub color: Option<String>,
    pub line_style: Option<String>,
}

/// A slice of the memory graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGraphPayload {
    pub nodes: Vec<HindsightGraphNode>,
    pub edges: Vec<HindsightGraphEdge>,
    pub total_units: u64,
}

/// A mental model maintained by the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMentalModel {
    pub id: String,
    pub bank_id: Option<String>,
    pub name: String,
    pub source_query: Option<String>,
    pub content: Option<String>,
    pub tags: Vec<String>,
    pub last_refreshed_at: Option<String>,
    pub last_memory_seen_at: Option<String>,
    pub last_refresh_failed_at: Option<String>,
    pub created_at: Option<String>,
    pub is_stale: bool,
}

/// A page of mental models.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMentalModelPage {
    pub items: Vec<HindsightMentalModel>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

// ── Wire model (snake_case, as the daemon answers) ─────────────────────

#[derive(Debug, Deserialize)]
struct RawBankList {
    #[serde(default)]
    banks: Vec<RawBankListItem>,
}

#[derive(Debug, Deserialize)]
struct RawBankListItem {
    #[serde(default)]
    bank_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawBankStats {
    #[serde(default)]
    bank_id: Option<String>,
    #[serde(default)]
    total_nodes: u64,
    #[serde(default)]
    total_links: u64,
    #[serde(default)]
    total_documents: u64,
    #[serde(default)]
    nodes_by_fact_type: BTreeMap<String, u64>,
    #[serde(default)]
    links_by_link_type: BTreeMap<String, u64>,
    #[serde(default)]
    pending_operations: u64,
    #[serde(default)]
    failed_operations: u64,
    #[serde(default)]
    pending_consolidation: u64,
    #[serde(default)]
    failed_consolidation: u64,
    #[serde(default)]
    last_consolidated_at: Option<String>,
    #[serde(default)]
    last_memory_write_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMemoryPage {
    #[serde(default)]
    items: Vec<RawMemoryItem>,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

#[derive(Debug, Deserialize)]
struct RawMemoryItem {
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    fact_type: Option<String>,
    #[serde(default)]
    document_id: Option<String>,
    #[serde(default)]
    mentioned_at: Option<String>,
    #[serde(default)]
    occurred_start: Option<String>,
    #[serde(default)]
    occurred_end: Option<String>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    entities: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    tags: Vec<String>,
    #[serde(default)]
    chunk_id: Option<String>,
    #[serde(default)]
    proof_count: u64,
    #[serde(default)]
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMemoryDetail {
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(rename = "type", default)]
    fact_type: Option<String>,
    #[serde(default)]
    document_id: Option<String>,
    #[serde(default)]
    mentioned_at: Option<String>,
    #[serde(default)]
    occurred_start: Option<String>,
    #[serde(default)]
    occurred_end: Option<String>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    entities: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    tags: Vec<String>,
    #[serde(default)]
    chunk_id: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    source_memory_ids: Vec<String>,
    #[serde(default)]
    source_memories: Vec<RawMemorySource>,
    #[serde(default)]
    history: Vec<RawHistoryEntry>,
}

#[derive(Debug, Deserialize)]
struct RawMemorySource {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(rename = "type", default)]
    fact_type: Option<String>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    occurred_start: Option<String>,
    #[serde(default)]
    mentioned_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct RawHistoryEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    changed_at: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    occurred_at: Option<String>,
    #[serde(default)]
    action: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawDocumentPage {
    #[serde(default)]
    items: Vec<RawDocumentItem>,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

#[derive(Debug, Deserialize)]
struct RawDocumentItem {
    id: String,
    #[serde(default)]
    bank_id: Option<String>,
    #[serde(default)]
    content_hash: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    text_length: u64,
    #[serde(default)]
    memory_unit_count: u64,
    #[serde(default)]
    retain_params: Option<Value>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawDocumentDetail {
    id: String,
    #[serde(default)]
    bank_id: Option<String>,
    #[serde(default)]
    original_text: Option<String>,
    #[serde(default)]
    content_hash: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    memory_unit_count: u64,
    #[serde(default)]
    nodes_by_fact_type: BTreeMap<String, u64>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    tags: Vec<String>,
    #[serde(default)]
    retain_params: Option<Value>,
    #[serde(default)]
    document_metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RawEntityPage {
    #[serde(default)]
    items: Vec<RawEntityItem>,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

#[derive(Debug, Deserialize)]
struct RawEntityItem {
    id: String,
    #[serde(default)]
    canonical_name: Option<String>,
    #[serde(default)]
    mention_count: u64,
    #[serde(default)]
    first_seen: Option<String>,
    #[serde(default)]
    last_seen: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawEntityDetail {
    id: String,
    #[serde(default)]
    canonical_name: Option<String>,
    #[serde(default)]
    mention_count: u64,
    #[serde(default)]
    first_seen: Option<String>,
    #[serde(default)]
    last_seen: Option<String>,
    #[serde(default)]
    observations: Vec<RawEntityObservation>,
}

#[derive(Debug, Deserialize)]
struct RawEntityObservation {
    #[serde(default)]
    text: String,
    #[serde(default)]
    mentioned_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMentalModelPage {
    #[serde(default)]
    items: Vec<RawMentalModel>,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

#[derive(Debug, Deserialize)]
struct RawMentalModel {
    id: String,
    #[serde(default)]
    bank_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    source_query: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default, deserialize_with = "deserialize_loose_strings")]
    tags: Vec<String>,
    #[serde(default)]
    last_refreshed_at: Option<String>,
    #[serde(default)]
    last_memory_seen_at: Option<String>,
    #[serde(default)]
    last_refresh_failed_at: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    is_stale: bool,
}

// ── Normalizers ────────────────────────────────────────────────────────

/// Accepts either a JSON array of strings or a comma-separated string.
///
/// The daemon uses a comma-separated string for `entities` in list responses
/// and a JSON array in detail responses, so both shapes must land in the
/// same list.
fn deserialize_loose_strings<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(loose_strings(&value))
}

/// Normalizes an array-or-comma-separated payload into a list of strings.
fn loose_strings(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect(),
        Value::String(raw) => raw
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

/// Reads a nested string field, ignoring anything that is not a string.
fn nested_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

/// Normalizes a memory unit of a list response.
fn normalize_memory_item(raw: &RawMemoryItem) -> HindsightMemoryItem {
    HindsightMemoryItem {
        id: raw.id.clone(),
        text: raw.text.clone(),
        context: raw.context.clone(),
        date: raw.date.clone(),
        fact_type: raw.fact_type.clone(),
        document_id: raw.document_id.clone(),
        mentioned_at: raw.mentioned_at.clone(),
        occurred_start: raw.occurred_start.clone(),
        occurred_end: raw.occurred_end.clone(),
        entities: raw.entities.clone(),
        tags: raw.tags.clone(),
        chunk_id: raw.chunk_id.clone(),
        proof_count: raw.proof_count,
        state: raw.state.clone(),
    }
}

/// Normalizes a memory unit of a detail response.
fn normalize_memory_detail(raw: &RawMemoryDetail) -> HindsightMemoryDetail {
    HindsightMemoryDetail {
        id: raw.id.clone(),
        text: raw.text.clone(),
        context: raw.context.clone(),
        date: raw.date.clone(),
        fact_type: raw.fact_type.clone(),
        document_id: raw.document_id.clone(),
        mentioned_at: raw.mentioned_at.clone(),
        occurred_start: raw.occurred_start.clone(),
        occurred_end: raw.occurred_end.clone(),
        entities: raw.entities.clone(),
        tags: raw.tags.clone(),
        chunk_id: raw.chunk_id.clone(),
        state: raw.state.clone(),
        source_memory_ids: raw.source_memory_ids.clone(),
        source_memories: raw
            .source_memories
            .iter()
            .map(|source| HindsightMemoryItem {
                id: source.id.clone().unwrap_or_default(),
                text: source.text.clone().unwrap_or_default(),
                context: source.context.clone(),
                date: source.mentioned_at.clone(),
                fact_type: source.fact_type.clone(),
                document_id: None,
                mentioned_at: source.mentioned_at.clone(),
                occurred_start: source.occurred_start.clone(),
                occurred_end: None,
                entities: Vec::new(),
                tags: Vec::new(),
                chunk_id: None,
                proof_count: 0,
                state: None,
            })
            .collect(),
        history: raw
            .history
            .iter()
            .map(|entry| HindsightMemoryHistoryEntry {
                id: entry.id.clone(),
                text: entry.text.clone(),
                changed_at: entry.changed_at.clone(),
                created_at: entry.created_at.clone(),
                occurred_at: entry.occurred_at.clone(),
                action: entry.action.clone(),
                raw: serde_json::to_value(entry).unwrap_or(Value::Null),
            })
            .collect(),
    }
}

/// Normalizes a bank statistics payload.
fn normalize_bank_stats(raw: &RawBankStats, fallback_bank: &str) -> HindsightBankStats {
    HindsightBankStats {
        bank_id: raw
            .bank_id
            .clone()
            .unwrap_or_else(|| fallback_bank.to_string()),
        total_nodes: raw.total_nodes,
        total_links: raw.total_links,
        total_documents: raw.total_documents,
        nodes_by_fact_type: raw.nodes_by_fact_type.clone(),
        links_by_link_type: raw.links_by_link_type.clone(),
        pending_operations: raw.pending_operations,
        failed_operations: raw.failed_operations,
        pending_consolidation: raw.pending_consolidation,
        failed_consolidation: raw.failed_consolidation,
        last_consolidated_at: raw.last_consolidated_at.clone(),
        last_memory_write_at: raw.last_memory_write_at.clone(),
    }
}

/// Normalizes the graph payload, whose edge fields are already camelCase.
fn normalize_graph(raw: &Value) -> HindsightGraphPayload {
    let nodes = raw
        .get("nodes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("data"))
                .map(|data| HindsightGraphNode {
                    id: data
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    label: data
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    text: data
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    date: data.get("date").and_then(Value::as_str).map(str::to_string),
                    context: data
                        .get("context")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    entities: loose_strings(data.get("entities").unwrap_or(&Value::Null)),
                    color: data
                        .get("color")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();

    let edges = raw
        .get("edges")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("data"))
                .map(|data| HindsightGraphEdge {
                    id: data
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    source: data
                        .get("source")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    target: data
                        .get("target")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    link_type: data
                        .get("linkType")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    weight: data.get("weight").and_then(Value::as_f64),
                    entity_name: data
                        .get("entityName")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    color: data
                        .get("color")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    line_style: data
                        .get("lineStyle")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();

    HindsightGraphPayload {
        nodes,
        edges,
        total_units: raw.get("total_units").and_then(Value::as_u64).unwrap_or(0),
    }
}

/// Extracts the `context` retained alongside a document.
fn document_context(retain_params: Option<&Value>) -> Option<String> {
    retain_params.and_then(|params| nested_str(params, "context"))
}

/// Normalizes the memory history payload, which the daemon does not document.
fn normalize_history(raw: &Value) -> Vec<HindsightMemoryHistoryEntry> {
    let items: Vec<Value> = match raw {
        Value::Array(items) => items.clone(),
        Value::Null => Vec::new(),
        other => vec![other.clone()],
    };

    items
        .iter()
        .map(|item| {
            let entry: RawHistoryEntry =
                serde_json::from_value(item.clone()).unwrap_or(RawHistoryEntry {
                    id: None,
                    text: None,
                    changed_at: None,
                    created_at: None,
                    occurred_at: None,
                    action: None,
                });
            HindsightMemoryHistoryEntry {
                id: entry.id.clone(),
                text: entry.text.clone(),
                changed_at: entry.changed_at.clone(),
                created_at: entry.created_at.clone(),
                occurred_at: entry.occurred_at.clone(),
                action: entry.action.clone(),
                raw: item.clone(),
            }
        })
        .collect()
}

// ── HTTP helpers ───────────────────────────────────────────────────────

/// Builds a client and the effective configuration for exploration calls.
fn explore_context(db: &Db) -> Result<(reqwest::blocking::Client, HindsightConfig), String> {
    let cfg = load_config(db);
    let client = build_client(HTTP_TIMEOUT_EXPLORE)
        .ok_or_else(|| "hindsight_client_unavailable: failed to build http client".to_string())?;
    Ok((client, cfg))
}

/// Builds the `/v1/default/banks/{bank}` prefix of a bank.
fn bank_path(bank: &str) -> String {
    format!("/v1/default/banks/{}", encode_path_segment(bank))
}

/// Appends percent-encoded query parameters to a URL without requiring `reqwest/query`.
fn append_query(url: &str, query: &[(&str, String)]) -> String {
    if query.is_empty() {
        return url.to_string();
    }
    let qs: Vec<String> = query
        .iter()
        .map(|(k, v)| format!("{}={}", encode_path_segment(k), encode_path_segment(v)))
        .collect();
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}{}", qs.join("&"))
}

/// Performs a GET request and decodes the JSON body.
fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
    query: &[(&str, String)],
) -> Result<T, String> {
    let full_url = append_query(url, query);
    send_json(client.get(&full_url))
}

/// Sends an arbitrary HTTP request and decodes the JSON response body.
fn send_json<T: serde::de::DeserializeOwned>(
    request: reqwest::blocking::RequestBuilder,
) -> Result<T, String> {
    let response = request
        .send()
        .map_err(|err| format!("hindsight_offline: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "hindsight_http_error: {} {}",
            status.as_u16(),
            snippet.trim()
        ));
    }
    response
        .json::<T>()
        .map_err(|err| format!("hindsight_invalid_json: {err}"))
}

/// Sends an HTTP request where an empty or 2xx response indicates success.
fn send_status_ok(request: reqwest::blocking::RequestBuilder) -> Result<(), String> {
    let response = request
        .send()
        .map_err(|err| format!("hindsight_offline: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "hindsight_http_error: {} {}",
            status.as_u16(),
            snippet.trim()
        ));
    }
    Ok(())
}

/// Clamps a requested page size.
fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_PAGE_LIMIT).clamp(1, MAX_PAGE_LIMIT)
}

/// Lists every bank with its headline counters.
///
/// The daemon does not expose the counters on the bank list itself, so each
/// bank is resolved against `/stats`. A bank whose statistics cannot be read
/// is still listed, with zeroed counters, so one unhealthy bank does not hide
/// the rest.
pub fn banks_list(db: &Db) -> Result<Vec<HindsightBankSummary>, String> {
    let (client, cfg) = explore_context(db)?;
    let raw: RawBankList = get_json(
        &client,
        &endpoint_url(&cfg.base_url, "/v1/default/banks"),
        &[],
    )
    .map_err(|err| format!("hindsight_banks_list: {err}"))?;

    let mut banks = Vec::new();
    for item in raw.banks {
        let id = item
            .bank_id
            .clone()
            .or_else(|| item.id.clone())
            .unwrap_or_default();
        if id.trim().is_empty() {
            continue;
        }
        let name = item
            .name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| id.clone());
        let stats = bank_stats_with(&client, &cfg, &id).ok();
        banks.push(HindsightBankSummary {
            id,
            name,
            total_nodes: stats.as_ref().map(|s| s.total_nodes).unwrap_or(0),
            total_links: stats.as_ref().map(|s| s.total_links).unwrap_or(0),
            total_documents: stats.as_ref().map(|s| s.total_documents).unwrap_or(0),
        });
    }
    Ok(banks)
}

/// Reads the statistics of a single bank.
pub fn bank_stats(db: &Db, bank: &str) -> Result<HindsightBankStats, String> {
    let (client, cfg) = explore_context(db)?;
    bank_stats_with(&client, &cfg, bank)
}

/// Reads the statistics of a bank with an existing client.
fn bank_stats_with(
    client: &reqwest::blocking::Client,
    cfg: &HindsightConfig,
    bank: &str,
) -> Result<HindsightBankStats, String> {
    let path = format!("{}/stats", bank_path(bank));
    let raw: RawBankStats = get_json(client, &endpoint_url(&cfg.base_url, &path), &[])
        .map_err(|err| format!("hindsight_bank_stats: {err}"))?;
    Ok(normalize_bank_stats(&raw, bank))
}

/// Lists memory units of a bank, optionally filtered by free text.
pub fn memories_list(
    db: &Db,
    bank: &str,
    query: Option<&str>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightMemoryPage, String> {
    memories_list_filtered(db, bank, query, None, limit, offset)
}

/// Lists memory units of a bank, optionally filtered by free text and `fact_type` (`world`, `experience`, `observation`).
pub fn memories_list_filtered(
    db: &Db,
    bank: &str,
    query: Option<&str>,
    fact_type: Option<&str>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightMemoryPage, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/memories/list", bank_path(bank));
    let limit = clamp_limit(limit);
    let offset = offset.unwrap_or(0);
    let mut params: Vec<(&str, String)> =
        vec![("limit", limit.to_string()), ("offset", offset.to_string())];
    if let Some(term) = query.map(str::trim).filter(|term| !term.is_empty()) {
        params.push(("q", term.to_string()));
    }
    if let Some(ft) = fact_type
        .map(str::trim)
        .filter(|ft| !ft.is_empty() && *ft != "all")
    {
        params.push(("type", ft.to_ascii_lowercase()));
    }
    let raw: RawMemoryPage = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_memories_list: {err}"))?;

    Ok(HindsightMemoryPage {
        items: raw.items.iter().map(normalize_memory_item).collect(),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
    })
}

/// Reads a single memory unit with its relations.
pub fn memory_get(db: &Db, bank: &str, memory_id: &str) -> Result<HindsightMemoryDetail, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/memories/{}",
        bank_path(bank),
        encode_path_segment(memory_id)
    );
    let raw: RawMemoryDetail = get_json(&client, &endpoint_url(&cfg.base_url, &path), &[])
        .map_err(|err| format!("hindsight_memory_get: {err}"))?;
    Ok(normalize_memory_detail(&raw))
}

/// Reads the revision history of a memory unit.
pub fn memory_history(
    db: &Db,
    bank: &str,
    memory_id: &str,
) -> Result<Vec<HindsightMemoryHistoryEntry>, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/memories/{}/history",
        bank_path(bank),
        encode_path_segment(memory_id)
    );
    let raw: Value = get_json(&client, &endpoint_url(&cfg.base_url, &path), &[])
        .map_err(|err| format!("hindsight_memory_history: {err}"))?;
    Ok(normalize_history(&raw))
}

/// Lists documents of a bank, optionally filtered by free text.
pub fn documents_list(
    db: &Db,
    bank: &str,
    query: Option<&str>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightDocumentPage, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/documents", bank_path(bank));
    let limit = clamp_limit(limit);
    let offset = offset.unwrap_or(0);
    let mut params: Vec<(&str, String)> =
        vec![("limit", limit.to_string()), ("offset", offset.to_string())];
    if let Some(term) = query.map(str::trim).filter(|term| !term.is_empty()) {
        params.push(("q", term.to_string()));
    }
    let raw: RawDocumentPage = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_documents_list: {err}"))?;

    Ok(HindsightDocumentPage {
        items: raw
            .items
            .iter()
            .map(|item| HindsightDocumentItem {
                id: item.id.clone(),
                bank_id: item.bank_id.clone(),
                content_hash: item.content_hash.clone(),
                created_at: item.created_at.clone(),
                updated_at: item.updated_at.clone(),
                text_length: item.text_length,
                memory_unit_count: item.memory_unit_count,
                context: document_context(item.retain_params.as_ref()),
                tags: item.tags.clone(),
            })
            .collect(),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
    })
}

/// Reads a document with its original text.
pub fn document_get(
    db: &Db,
    bank: &str,
    document_id: &str,
) -> Result<HindsightDocumentDetail, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/documents/{}",
        bank_path(bank),
        encode_path_segment(document_id)
    );
    let raw: RawDocumentDetail = get_json(&client, &endpoint_url(&cfg.base_url, &path), &[])
        .map_err(|err| format!("hindsight_document_get: {err}"))?;

    Ok(HindsightDocumentDetail {
        id: raw.id.clone(),
        bank_id: raw.bank_id.clone(),
        original_text: raw.original_text.clone(),
        content_hash: raw.content_hash.clone(),
        created_at: raw.created_at.clone(),
        updated_at: raw.updated_at.clone(),
        memory_unit_count: raw.memory_unit_count,
        nodes_by_fact_type: raw.nodes_by_fact_type.clone(),
        tags: raw.tags.clone(),
        context: document_context(raw.retain_params.as_ref()),
        metadata: raw.document_metadata.clone().unwrap_or(Value::Null),
    })
}

/// Lists entities of a bank ordered by mention count.
pub fn entities_list(
    db: &Db,
    bank: &str,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightEntityPage, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/entities", bank_path(bank));
    let limit = clamp_limit(limit);
    let offset = offset.unwrap_or(0);
    let params: Vec<(&str, String)> =
        vec![("limit", limit.to_string()), ("offset", offset.to_string())];
    let raw: RawEntityPage = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_entities_list: {err}"))?;

    Ok(HindsightEntityPage {
        items: raw
            .items
            .iter()
            .map(|item| HindsightEntityItem {
                id: item.id.clone(),
                canonical_name: item.canonical_name.clone().unwrap_or_default(),
                mention_count: item.mention_count,
                first_seen: item.first_seen.clone(),
                last_seen: item.last_seen.clone(),
            })
            .collect(),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
    })
}

/// Reads a single entity with the observations that mention it.
pub fn entity_get(db: &Db, bank: &str, entity_id: &str) -> Result<HindsightEntityDetail, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/entities/{}",
        bank_path(bank),
        encode_path_segment(entity_id)
    );
    let raw: RawEntityDetail = get_json(&client, &endpoint_url(&cfg.base_url, &path), &[])
        .map_err(|err| format!("hindsight_entity_get: {err}"))?;

    Ok(HindsightEntityDetail {
        id: raw.id.clone(),
        canonical_name: raw.canonical_name.clone().unwrap_or_default(),
        mention_count: raw.mention_count,
        first_seen: raw.first_seen.clone(),
        last_seen: raw.last_seen.clone(),
        observations: raw
            .observations
            .iter()
            .map(|observation| HindsightEntityObservation {
                text: observation.text.clone(),
                mentioned_at: observation.mentioned_at.clone(),
            })
            .collect(),
    })
}

/// Reads a slice of the memory graph.
pub fn graph(
    db: &Db,
    bank: &str,
    limit: Option<usize>,
    query: Option<&str>,
) -> Result<HindsightGraphPayload, String> {
    graph_filtered(db, bank, limit, query, None)
}

/// Reads a slice of the memory graph, optionally filtered by `fact_type` (`world`, `experience`, `observation`).
pub fn graph_filtered(
    db: &Db,
    bank: &str,
    limit: Option<usize>,
    query: Option<&str>,
    fact_type: Option<&str>,
) -> Result<HindsightGraphPayload, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/graph", bank_path(bank));
    let mut params: Vec<(&str, String)> = vec![("limit", clamp_limit(limit).to_string())];
    if let Some(term) = query.map(str::trim).filter(|term| !term.is_empty()) {
        params.push(("q", term.to_string()));
    }
    if let Some(ft) = fact_type
        .map(str::trim)
        .filter(|ft| !ft.is_empty() && *ft != "all")
    {
        params.push(("type", ft.to_ascii_lowercase()));
    }
    let raw: Value = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_graph: {err}"))?;
    Ok(normalize_graph(&raw))
}

/// Lists the mental models of a bank (requesting `detail=content` so synthesized markdown is included).
pub fn mental_models(
    db: &Db,
    bank: &str,
    limit: Option<usize>,
) -> Result<HindsightMentalModelPage, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/mental-models", bank_path(bank));
    let limit = clamp_limit(limit);
    let params: Vec<(&str, String)> = vec![
        ("limit", limit.to_string()),
        ("detail", "content".to_string()),
    ];
    let raw: RawMentalModelPage = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_mental_models: {err}"))?;

    Ok(HindsightMentalModelPage {
        items: raw
            .items
            .iter()
            .map(|item| HindsightMentalModel {
                id: item.id.clone(),
                bank_id: item.bank_id.clone(),
                name: item.name.clone().unwrap_or_default(),
                source_query: item.source_query.clone(),
                content: item.content.clone(),
                tags: item.tags.clone(),
                last_refreshed_at: item.last_refreshed_at.clone(),
                last_memory_seen_at: item.last_memory_seen_at.clone(),
                last_refresh_failed_at: item.last_refresh_failed_at.clone(),
                created_at: item.created_at.clone(),
                is_stale: item.is_stale,
            })
            .collect(),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
    })
}

/// A bank directive guiding memory extraction and reflection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightDirective {
    pub id: String,
    pub bank_id: Option<String>,
    pub name: String,
    pub content: String,
    pub priority: i64,
    pub is_active: bool,
    pub tags: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A background operation running on a Hindsight bank.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightOperation {
    pub id: String,
    pub operation_type: String,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub error_message: Option<String>,
}

/// Creates or updates a Hindsight bank (`PUT /v1/default/banks/{bank_id}`).
pub fn bank_create(
    db: &Db,
    bank_id: &str,
    name: Option<&str>,
    mission: Option<&str>,
    background: Option<&str>,
) -> Result<HindsightBankSummary, String> {
    let clean_id = bank_id.trim();
    if clean_id.is_empty() {
        return Err("bank_id_required".to_string());
    }
    let (client, cfg) = explore_context(db)?;
    let path = bank_path(clean_id);
    let display_name = name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(clean_id);
    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), Value::String(display_name.to_string()));
    if let Some(m) = mission.map(str::trim).filter(|s| !s.is_empty()) {
        payload.insert("mission".to_string(), Value::String(m.to_string()));
        payload.insert("retain_mission".to_string(), Value::String(m.to_string()));
        payload.insert("reflect_mission".to_string(), Value::String(m.to_string()));
    }
    if let Some(bg) = background.map(str::trim).filter(|s| !s.is_empty()) {
        payload.insert("background".to_string(), Value::String(bg.to_string()));
    }
    let req = client
        .put(endpoint_url(&cfg.base_url, &path))
        .json(&Value::Object(payload));
    send_status_ok(req).map_err(|err| format!("hindsight_bank_create: {err}"))?;

    let stats = bank_stats_with(&client, &cfg, clean_id).ok();
    Ok(HindsightBankSummary {
        id: clean_id.to_string(),
        name: display_name.to_string(),
        total_nodes: stats.as_ref().map(|s| s.total_nodes).unwrap_or(0),
        total_links: stats.as_ref().map(|s| s.total_links).unwrap_or(0),
        total_documents: stats.as_ref().map(|s| s.total_documents).unwrap_or(0),
    })
}

/// Creates a new mental model in `bank` (`POST /v1/default/banks/{bank}/mental-models`).
pub fn mental_model_create(
    db: &Db,
    bank: &str,
    name: &str,
    source_query: &str,
    custom_id: Option<&str>,
    tags: Vec<String>,
) -> Result<HindsightMentalModel, String> {
    let clean_name = name.trim();
    let clean_query = source_query.trim();
    if clean_name.is_empty() || clean_query.is_empty() {
        return Err("mental_model_name_and_query_required".to_string());
    }
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/mental-models", bank_path(bank));
    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), Value::String(clean_name.to_string()));
    payload.insert(
        "source_query".to_string(),
        Value::String(clean_query.to_string()),
    );
    if let Some(cid) = custom_id.map(str::trim).filter(|s| !s.is_empty()) {
        payload.insert("id".to_string(), Value::String(cid.to_string()));
    }
    if !tags.is_empty() {
        payload.insert(
            "tags".to_string(),
            Value::Array(tags.into_iter().map(Value::String).collect()),
        );
    }

    let raw: RawMentalModel = send_json(
        client
            .post(endpoint_url(&cfg.base_url, &path))
            .json(&Value::Object(payload)),
    )
    .map_err(|err| format!("hindsight_mental_model_create: {err}"))?;

    Ok(HindsightMentalModel {
        id: raw.id,
        bank_id: raw.bank_id.or_else(|| Some(bank.to_string())),
        name: raw.name.unwrap_or_else(|| clean_name.to_string()),
        source_query: raw.source_query.or_else(|| Some(clean_query.to_string())),
        content: raw.content,
        tags: raw.tags,
        last_refreshed_at: raw.last_refreshed_at,
        last_memory_seen_at: raw.last_memory_seen_at,
        last_refresh_failed_at: raw.last_refresh_failed_at,
        created_at: raw.created_at,
        is_stale: raw.is_stale,
    })
}

/// Triggers an asynchronous or immediate synthesis refresh of a mental model.
pub fn mental_model_refresh(db: &Db, bank: &str, model_id: &str) -> Result<Value, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/mental-models/{}/refresh",
        bank_path(bank),
        encode_path_segment(model_id)
    );
    send_json(client.post(endpoint_url(&cfg.base_url, &path)))
        .map_err(|err| format!("hindsight_mental_model_refresh: {err}"))
}

/// Deletes a mental model from `bank`.
pub fn mental_model_delete(db: &Db, bank: &str, model_id: &str) -> Result<bool, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/mental-models/{}",
        bank_path(bank),
        encode_path_segment(model_id)
    );
    send_status_ok(client.delete(endpoint_url(&cfg.base_url, &path)))
        .map_err(|err| format!("hindsight_mental_model_delete: {err}"))?;
    Ok(true)
}

/// Manually retains a memory item into `bank` (`POST /v1/default/banks/{bank}/memories`).
pub fn memory_retain(
    db: &Db,
    bank: &str,
    content: &str,
    context: Option<&str>,
    tags: Vec<String>,
) -> Result<Value, String> {
    let clean_content = content.trim();
    if clean_content.is_empty() {
        return Err("memory_content_required".to_string());
    }
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/memories", bank_path(bank));
    let mut item = serde_json::Map::new();
    item.insert(
        "content".to_string(),
        Value::String(clean_content.to_string()),
    );
    if let Some(ctx) = context.map(str::trim).filter(|s| !s.is_empty()) {
        item.insert("context".to_string(), Value::String(ctx.to_string()));
    }
    if !tags.is_empty() {
        item.insert(
            "tags".to_string(),
            Value::Array(tags.into_iter().map(Value::String).collect()),
        );
    }
    let body = serde_json::json!({
        "items": [Value::Object(item)],
        "async": false
    });
    send_json(client.post(endpoint_url(&cfg.base_url, &path)).json(&body))
        .map_err(|err| format!("hindsight_memory_retain: {err}"))
}

/// Lists directives configured on `bank`.
pub fn directives_list(db: &Db, bank: &str) -> Result<Vec<HindsightDirective>, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/directives", bank_path(bank));
    let params = vec![
        ("active_only", "false".to_string()),
        ("limit", "100".to_string()),
    ];
    let raw: Value = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_directives_list: {err}"))?;
    let items = raw
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(items
        .iter()
        .map(|d| HindsightDirective {
            id: d
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            bank_id: d.get("bank_id").and_then(Value::as_str).map(str::to_string),
            name: d
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            content: d
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            priority: d.get("priority").and_then(Value::as_i64).unwrap_or(0),
            is_active: d.get("is_active").and_then(Value::as_bool).unwrap_or(true),
            tags: loose_strings(d.get("tags").unwrap_or(&Value::Null)),
            created_at: d
                .get("created_at")
                .and_then(Value::as_str)
                .map(str::to_string),
            updated_at: d
                .get("updated_at")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect())
}

/// Creates a directive on `bank`.
pub fn directive_create(
    db: &Db,
    bank: &str,
    name: &str,
    content: &str,
    tags: Vec<String>,
) -> Result<HindsightDirective, String> {
    let clean_name = name.trim();
    let clean_content = content.trim();
    if clean_name.is_empty() || clean_content.is_empty() {
        return Err("directive_name_and_content_required".to_string());
    }
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/directives", bank_path(bank));
    let body = serde_json::json!({
        "name": clean_name,
        "content": clean_content,
        "priority": 0,
        "is_active": true,
        "tags": tags
    });
    let d: Value = send_json(client.post(endpoint_url(&cfg.base_url, &path)).json(&body))
        .map_err(|err| format!("hindsight_directive_create: {err}"))?;
    Ok(HindsightDirective {
        id: d
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        bank_id: d.get("bank_id").and_then(Value::as_str).map(str::to_string),
        name: d
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(clean_name)
            .to_string(),
        content: d
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or(clean_content)
            .to_string(),
        priority: d.get("priority").and_then(Value::as_i64).unwrap_or(0),
        is_active: d.get("is_active").and_then(Value::as_bool).unwrap_or(true),
        tags: loose_strings(d.get("tags").unwrap_or(&Value::Null)),
        created_at: d
            .get("created_at")
            .and_then(Value::as_str)
            .map(str::to_string),
        updated_at: d
            .get("updated_at")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Deletes a directive from `bank`.
pub fn directive_delete(db: &Db, bank: &str, directive_id: &str) -> Result<bool, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!(
        "{}/directives/{}",
        bank_path(bank),
        encode_path_segment(directive_id)
    );
    send_status_ok(client.delete(endpoint_url(&cfg.base_url, &path)))
        .map_err(|err| format!("hindsight_directive_delete: {err}"))?;
    Ok(true)
}

/// Lists recent background operations on `bank`.
pub fn operations_list(
    db: &Db,
    bank: &str,
    limit: Option<usize>,
) -> Result<Vec<HindsightOperation>, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/operations", bank_path(bank));
    let params = vec![("limit", limit.unwrap_or(20).clamp(1, 100).to_string())];
    let raw: Value = get_json(&client, &endpoint_url(&cfg.base_url, &path), &params)
        .map_err(|err| format!("hindsight_operations_list: {err}"))?;
    let items = raw
        .get("operations")
        .or_else(|| raw.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(items
        .iter()
        .map(|op| HindsightOperation {
            id: op
                .get("id")
                .or_else(|| op.get("operation_id"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            operation_type: op
                .get("operation_type")
                .or_else(|| op.get("task_type"))
                .and_then(Value::as_str)
                .unwrap_or("operation")
                .to_string(),
            status: op
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            created_at: op
                .get("created_at")
                .and_then(Value::as_str)
                .map(str::to_string),
            updated_at: op
                .get("updated_at")
                .and_then(Value::as_str)
                .map(str::to_string),
            error_message: op
                .get("error_message")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect())
}

/// Triggers memory consolidation on `bank` (`POST /v1/default/banks/{bank}/consolidate`).
pub fn bank_consolidate(db: &Db, bank: &str) -> Result<Value, String> {
    let (client, cfg) = explore_context(db)?;
    let path = format!("{}/consolidate", bank_path(bank));
    send_json(client.post(endpoint_url(&cfg.base_url, &path)))
        .map_err(|err| format!("hindsight_bank_consolidate: {err}"))
}

/// Searches a bank by free text using the daemon's memory index.
///
/// The daemon exposes `/knowledge-base/search`, but it answers empty even for
/// terms that exist in the bank, so the search runs over `/memories/list`
/// which does return real hits.
pub fn search(
    db: &Db,
    bank: &str,
    query: &str,
    limit: Option<usize>,
) -> Result<HindsightMemoryPage, String> {
    memories_list(db, bank, Some(query), limit, Some(0))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGlobalSearchHit {
    pub id: String,
    pub bank_id: String,
    pub bank_name: String,
    pub text: String,
    pub context: Option<String>,
    pub fact_type: Option<String>,
    pub date: Option<String>,
    pub document_id: Option<String>,
    pub entities: Vec<String>,
    pub tags: Vec<String>,
    pub match_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGalaxyGlobe {
    pub id: String,
    pub bank_id: String,
    pub bank_name: String,
    pub title: String,
    pub content: String,
    pub fact_type: String,
    pub date: Option<String>,
    pub context: Option<String>,
    pub document_id: Option<String>,
    pub entities: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGalaxyLink {
    pub source: String,
    pub target: String,
    pub bank_id: String,
    pub link_type: Option<String>,
    pub weight: f64,
    pub entity_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightGalaxySnapshot {
    pub online: bool,
    pub banks: Vec<HindsightBankSummary>,
    pub globes: Vec<HindsightGalaxyGlobe>,
    pub links: Vec<HindsightGalaxyLink>,
    pub total_real_nodes: u64,
}

/// Global search across all Hindsight banks (or one bank), optionally filtered by `fact_type`.
pub fn global_search(
    db: &Db,
    query: &str,
    bank: Option<&str>,
    fact_type: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<HindsightGlobalSearchHit>, String> {
    let q = query.trim();
    let per_bank_limit = clamp_limit(limit);
    let type_filter = fact_type
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all")
        .map(|s| s.to_ascii_lowercase());

    let banks = match bank.map(str::trim).filter(|s| !s.is_empty()) {
        Some(target) => vec![HindsightBankSummary {
            id: target.to_string(),
            name: target.to_string(),
            total_nodes: 0,
            total_links: 0,
            total_documents: 0,
        }],
        None => banks_list(db).unwrap_or_default(),
    };

    let (client, cfg) = explore_context(db)?;
    let mut hits: Vec<HindsightGlobalSearchHit> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for b in banks {
        let path = format!("{}/memories/list", bank_path(&b.id));
        let mut params: Vec<(&str, String)> = vec![
            ("limit", per_bank_limit.to_string()),
            ("offset", "0".to_string()),
        ];
        if !q.is_empty() {
            params.push(("q", q.to_string()));
        }
        if let Some(ref ft) = type_filter {
            params.push(("type", ft.clone()));
        }
        if let Ok(page) =
            get_json::<RawMemoryPage>(&client, &endpoint_url(&cfg.base_url, &path), &params)
        {
            for item in page.items {
                if !seen_ids.insert(item.id.clone()) {
                    continue;
                }
                let norm = normalize_memory_item(&item);
                hits.push(HindsightGlobalSearchHit {
                    id: norm.id,
                    bank_id: b.id.clone(),
                    bank_name: b.name.clone(),
                    text: norm.text,
                    context: norm.context,
                    fact_type: norm.fact_type,
                    date: norm.date,
                    document_id: norm.document_id,
                    entities: norm.entities,
                    tags: norm.tags,
                    match_kind: "text".to_string(),
                });
            }
        }
    }

    Ok(hits)
}

/// Snapshot of real Hindsight banks, memory globes, and graph relations for the 3D Memory Galaxy.
pub fn galaxy_snapshot(
    db: &Db,
    bank_filter: Option<&str>,
    limit_per_bank: Option<usize>,
) -> Result<HindsightGalaxySnapshot, String> {
    let per_bank = limit_per_bank.unwrap_or(18).clamp(4, 50);
    let banks = match banks_list(db) {
        Ok(list) if !list.is_empty() => list,
        _ => {
            // Honest offline fallback from SQLite when Hindsight daemon is unavailable.
            let local = auradesk_core::application::memories::LocalMemoryService::new(db);
            let local_items = local.recall(bank_filter, "", 60).unwrap_or_default();
            let globes: Vec<HindsightGalaxyGlobe> = local_items
                .into_iter()
                .filter(|m| m.topic_key.as_deref() != Some("bank_registry"))
                .map(|m| HindsightGalaxyGlobe {
                    id: m.id,
                    bank_id: m.bank.clone(),
                    bank_name: m.bank,
                    title: m.topic_key.unwrap_or_else(|| "sqlite_memory".into()),
                    content: m.content,
                    fact_type: "local".into(),
                    date: Some(m.created_at),
                    context: m.change_reason,
                    document_id: None,
                    entities: Vec::new(),
                    tags: Vec::new(),
                })
                .collect();
            let total_real_nodes = globes.len() as u64;
            return Ok(HindsightGalaxySnapshot {
                online: false,
                banks: Vec::new(),
                globes,
                links: Vec::new(),
                total_real_nodes,
            });
        }
    };

    let selected_banks: Vec<HindsightBankSummary> =
        match bank_filter.map(str::trim).filter(|s| !s.is_empty()) {
            Some(target) => banks.iter().filter(|b| b.id == target).cloned().collect(),
            None => banks.clone(),
        };

    let total_real_nodes: u64 = banks.iter().map(|b| b.total_nodes).sum();
    let mut globes = Vec::new();
    let mut links = Vec::new();
    let mut seen_globe_ids = std::collections::HashSet::new();

    for b in selected_banks {
        if let Ok(page) = memories_list(db, &b.id, None, Some(per_bank), Some(0)) {
            for item in page.items {
                if !seen_globe_ids.insert(item.id.clone()) {
                    continue;
                }
                let title = item
                    .context
                    .clone()
                    .filter(|c| !c.trim().is_empty())
                    .unwrap_or_else(|| {
                        let first_line = item.text.lines().next().unwrap_or(&item.text);
                        first_line.chars().take(64).collect()
                    });
                globes.push(HindsightGalaxyGlobe {
                    id: item.id,
                    bank_id: b.id.clone(),
                    bank_name: b.name.clone(),
                    title,
                    content: item.text,
                    fact_type: item.fact_type.unwrap_or_else(|| "world".to_string()),
                    date: item.date.or(item.mentioned_at),
                    context: item.context,
                    document_id: item.document_id,
                    entities: item.entities,
                    tags: item.tags,
                });
            }
        }
        if let Ok(gr) = graph(db, &b.id, Some(per_bank * 2), None) {
            for edge in gr.edges {
                links.push(HindsightGalaxyLink {
                    source: edge.source,
                    target: edge.target,
                    bank_id: b.id.clone(),
                    link_type: edge.link_type,
                    weight: edge.weight.unwrap_or(0.5),
                    entity_name: edge.entity_name,
                });
            }
        }
    }

    Ok(HindsightGalaxySnapshot {
        online: true,
        banks,
        globes,
        links,
        total_real_nodes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats_json() -> Value {
        serde_json::json!({
            "bank_id": "estudos",
            "total_nodes": 5733,
            "total_links": 537020,
            "total_documents": 112,
            "nodes_by_fact_type": {"experience": 454, "observation": 2138, "world": 3141},
            "links_by_link_type": {"caused_by": 874, "semantic": 296616},
            "pending_operations": 0,
            "failed_operations": 1,
            "pending_consolidation": 794,
            "failed_consolidation": 92,
            "last_consolidated_at": "2026-11-22T15:27:15.892854+00:00",
            "last_memory_write_at": null
        })
    }

    #[test]
    fn normalizes_bank_stats_with_counters_and_breakdown() {
        let raw: RawBankStats = serde_json::from_value(stats_json()).expect("stats parse");
        let stats = normalize_bank_stats(&raw, "fallback");

        assert_eq!(stats.bank_id, "estudos");
        assert_eq!(stats.total_nodes, 5733);
        assert_eq!(stats.total_links, 537020);
        assert_eq!(stats.total_documents, 112);
        assert_eq!(stats.nodes_by_fact_type.get("world"), Some(&3141));
        assert_eq!(stats.links_by_link_type.get("semantic"), Some(&296616));
        assert_eq!(stats.failed_operations, 1);
        assert_eq!(stats.pending_consolidation, 794);
        assert!(stats.last_memory_write_at.is_none());
    }

    #[test]
    fn normalizes_bank_stats_falling_back_to_the_requested_bank() {
        let raw: RawBankStats =
            serde_json::from_value(serde_json::json!({})).expect("empty stats parse");
        let stats = normalize_bank_stats(&raw, "garos");
        assert_eq!(stats.bank_id, "garos");
        assert_eq!(stats.total_nodes, 0);
    }

    #[test]
    fn normalizes_memory_list_items_with_csv_entities() {
        let payload = serde_json::json!({
            "items": [{
                "id": "mem-1",
                "text": "imagem da FORTINET-VM e FortiFirewall VM64 KVM.",
                "context": "fortinet-vm-booted",
                "date": "2026-11-21T22:18:59.784202+00:00",
                "fact_type": "observation",
                "document_id": "doc-1",
                "mentioned_at": "2026-11-21T22:18:59.784202+00:00",
                "occurred_start": "2026-11-21T22:18:59.784202+00:00",
                "occurred_end": "2026-11-21T22:18:59.784202+00:00",
                "entities": "libvirt, fortinet , fortifirewall-vm64-kvm",
                "chunk_id": "estudos_doc-1_0",
                "proof_count": 1,
                "tags": ["cli", "ffw"],
                "state": "valid"
            }],
            "total": 5688,
            "limit": 25,
            "offset": 0
        });
        let raw: RawMemoryPage = serde_json::from_value(payload).expect("memory page parse");
        assert_eq!(raw.total, 5688);

        let items: Vec<HindsightMemoryItem> = raw.items.iter().map(normalize_memory_item).collect();
        let item = &items[0];
        assert_eq!(item.id, "mem-1");
        assert_eq!(item.fact_type.as_deref(), Some("observation"));
        assert_eq!(
            item.entities,
            vec!["libvirt", "fortinet", "fortifirewall-vm64-kvm"]
        );
        assert_eq!(item.tags, vec!["cli", "ffw"]);
        assert_eq!(item.proof_count, 1);
        assert_eq!(item.document_id.as_deref(), Some("doc-1"));
    }

    #[test]
    fn normalizes_memory_detail_with_array_entities_and_sources() {
        let payload = serde_json::json!({
            "id": "mem-2",
            "text": "appliance fortinet foi instalado.",
            "context": "fortinet-vm-booted",
            "date": "2026-11-21T22:18:59.784202+00:00",
            "type": "world",
            "entities": ["libvirt", "fortinet"],
            "tags": ["ffw"],
            "document_id": "doc-1",
            "state": "valid",
            "source_memory_ids": ["mem-1"],
            "source_memories": [{
                "id": "mem-1",
                "text": "imagem da FORTINET-VM.",
                "type": "observation",
                "context": "ctx",
                "occurred_start": "2026-11-21T22:18:59+00:00",
                "mentioned_at": "2026-11-21T22:18:59+00:00"
            }],
            "history": []
        });
        let raw: RawMemoryDetail = serde_json::from_value(payload).expect("memory detail parse");
        let detail = normalize_memory_detail(&raw);

        assert_eq!(detail.fact_type.as_deref(), Some("world"));
        assert_eq!(detail.entities, vec!["libvirt", "fortinet"]);
        assert_eq!(detail.source_memory_ids, vec!["mem-1"]);
        assert_eq!(detail.source_memories.len(), 1);
        assert_eq!(detail.source_memories[0].id, "mem-1");
        assert_eq!(
            detail.source_memories[0].fact_type.as_deref(),
            Some("observation")
        );
        assert!(detail.history.is_empty());
    }

    #[test]
    fn normalizes_memory_history_entries_keeping_the_raw_payload() {
        let payload = serde_json::json!([
            {
                "id": "mem-3",
                "text": "versao antiga",
                "changed_at": "2026-11-20T10:00:00+00:00",
                "action": "edit",
                "extra": "ignored-by-the-model"
            }
        ]);
        let history = normalize_history(&payload);

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id.as_deref(), Some("mem-3"));
        assert_eq!(history[0].action.as_deref(), Some("edit"));
        assert_eq!(
            history[0].raw.get("extra").and_then(Value::as_str),
            Some("ignored-by-the-model")
        );
    }

    #[test]
    fn normalizes_an_empty_history_payload() {
        assert!(normalize_history(&Value::Array(Vec::new())).is_empty());
        assert!(normalize_history(&Value::Null).is_empty());
    }

    #[test]
    fn normalizes_graph_nodes_and_edges() {
        let payload = serde_json::json!({
            "nodes": [{
                "data": {
                    "id": "n-1",
                    "label": "interface_2d_unifi",
                    "text": "interface 2d redesenhada no estilo unifi.",
                    "date": "2026-11-22T02:04:32.518664+00:00",
                    "context": "rack-monitor",
                    "entities": "unifi, sparklines",
                    "color": "#42a5f5"
                }
            }],
            "edges": [{
                "data": {
                    "id": "e-1",
                    "source": "n-1",
                    "target": "n-2",
                    "linkType": "semantic",
                    "weight": 1.0,
                    "entityName": "",
                    "color": "#ff69b4",
                    "lineStyle": "solid"
                }
            }],
            "total_units": 960,
            "limit": 3
        });
        let graph = normalize_graph(&payload);

        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.nodes[0].id, "n-1");
        assert_eq!(graph.nodes[0].entities, vec!["unifi", "sparklines"]);
        assert_eq!(graph.nodes[0].color.as_deref(), Some("#42a5f5"));
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.edges[0].link_type.as_deref(), Some("semantic"));
        assert_eq!(graph.edges[0].source, "n-1");
        assert_eq!(graph.edges[0].weight, Some(1.0));
        assert_eq!(graph.total_units, 960);
    }

    #[test]
    fn normalizes_an_empty_graph_payload() {
        let graph = normalize_graph(&serde_json::json!({}));
        assert!(graph.nodes.is_empty());
        assert!(graph.edges.is_empty());
        assert_eq!(graph.total_units, 0);
    }

    #[test]
    fn normalizes_entities_and_observations() {
        let payload = serde_json::json!({
            "items": [{
                "id": "e-1",
                "canonical_name": "fortinet_nse1",
                "mention_count": 979,
                "first_seen": "1994-01-01T00:00:00.080000+00:00",
                "last_seen": "2026-11-21T21:51:21.096674+00:00"
            }],
            "total": 8522,
            "limit": 3,
            "offset": 0
        });
        let raw: RawEntityPage = serde_json::from_value(payload).expect("entity page parse");
        assert_eq!(raw.total, 8522);
        assert_eq!(
            raw.items[0].canonical_name.as_deref(),
            Some("fortinet_nse1")
        );
        assert_eq!(raw.items[0].mention_count, 979);

        let detail_payload = serde_json::json!({
            "id": "e-1",
            "canonical_name": "fortinet_nse1",
            "mention_count": 979,
            "observations": [{
                "text": "estudo_fortinet_nse1",
                "mentioned_at": "2026-11-21T21:00:00+00:00"
            }]
        });
        let raw_detail: RawEntityDetail =
            serde_json::from_value(detail_payload).expect("entity detail parse");
        assert_eq!(raw_detail.observations.len(), 1);
        assert_eq!(raw_detail.observations[0].text, "estudo_fortinet_nse1");
    }

    #[test]
    fn reads_the_document_context_out_of_retain_params() {
        let params = serde_json::json!({ "context": "rack-monitor-multitenant" });
        assert_eq!(
            document_context(Some(&params)).as_deref(),
            Some("rack-monitor-multitenant")
        );
        assert!(document_context(None).is_none());
        assert!(document_context(Some(&serde_json::json!({}))).is_none());
    }

    #[test]
    fn clamps_the_requested_page_size() {
        assert_eq!(clamp_limit(None), DEFAULT_PAGE_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(10)), 10);
        assert_eq!(clamp_limit(Some(10_000)), MAX_PAGE_LIMIT);
    }

    #[test]
    fn loose_strings_accepts_arrays_and_comma_separated_strings() {
        let array = serde_json::json!(["a", " b ", "", "c"]);
        assert_eq!(loose_strings(&array), vec!["a", "b", "c"]);

        let csv = serde_json::json!("a, b ,, c");
        assert_eq!(loose_strings(&csv), vec!["a", "b", "c"]);

        assert!(loose_strings(&Value::Null).is_empty());
    }
}
