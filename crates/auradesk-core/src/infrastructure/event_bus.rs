//! In-memory and persisted event bus with deduplication and normalized plugin event distribution.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::plugin::NormalizedPluginEvent;

/// Result of dispatching an event to the EventBus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventDispatchResult {
    /// Event accepted as new.
    Accepted(NormalizedPluginEvent),
    /// Event was deduplicated and ignored.
    Deduplicated { event_id: String },
}

/// In-memory deduplicating event bus.
pub struct EventBus {
    dedup_window: Duration,
    seen_events: Mutex<HashMap<String, DateTime<Utc>>>,
    recent_events: Mutex<VecDeque<NormalizedPluginEvent>>,
    max_history: usize,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(Duration::minutes(30), 200)
    }
}

impl EventBus {
    /// Create a new event bus with deduplication window and max history size.
    pub fn new(dedup_window: Duration, max_history: usize) -> Self {
        Self {
            dedup_window,
            seen_events: Mutex::new(HashMap::new()),
            recent_events: Mutex::new(VecDeque::new()),
            max_history,
        }
    }

    /// Generate deduplication key for an event.
    fn dedup_key(event: &NormalizedPluginEvent) -> String {
        format!("{}:{}:{}", event.plugin_id, event.event_type, event.resource_id)
    }

    /// Publish an event. Deduplicates if seen recently.
    pub fn publish(&self, event: NormalizedPluginEvent) -> EventDispatchResult {
        let now = Utc::now();
        let key = Self::dedup_key(&event);

        let mut seen = self.seen_events.lock().unwrap();
        // Prune expired dedup keys
        seen.retain(|_, seen_time| now.signed_duration_since(*seen_time) < self.dedup_window);

        if let Some(prev) = seen.get(&key) {
            if now.signed_duration_since(*prev) < self.dedup_window {
                return EventDispatchResult::Deduplicated {
                    event_id: event.event_id,
                };
            }
        }

        seen.insert(key, now);
        drop(seen);

        let mut history = self.recent_events.lock().unwrap();
        history.push_front(event.clone());
        if history.len() > self.max_history {
            history.pop_back();
        }

        EventDispatchResult::Accepted(event)
    }

    /// List recent accepted events.
    pub fn list_recent(&self, limit: usize) -> Vec<NormalizedPluginEvent> {
        let history = self.recent_events.lock().unwrap();
        history.iter().take(limit).cloned().collect()
    }

    /// Clear all seen records and history (useful for tests or teardown).
    pub fn clear(&self) {
        self.seen_events.lock().unwrap().clear();
        self.recent_events.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deduplicates_identical_events_within_window() {
        let bus = EventBus::new(Duration::minutes(5), 50);
        let ev1 = NormalizedPluginEvent {
            event_id: "ev1".into(),
            plugin_id: "manageengine".into(),
            event_type: "ticket.assigned".into(),
            resource_id: "TICKET-123".into(),
            title: "New ticket assigned".into(),
            summary: "Printer broken".into(),
            severity: "high".into(),
            timestamp: Utc::now().to_rfc3339(),
            raw_data: serde_json::json!({}),
        };

        let res1 = bus.publish(ev1.clone());
        assert!(matches!(res1, EventDispatchResult::Accepted(_)));

        // Duplicate
        let res2 = bus.publish(ev1);
        assert!(matches!(res2, EventDispatchResult::Deduplicated { .. }));

        // Different ticket
        let ev2 = NormalizedPluginEvent {
            event_id: "ev2".into(),
            plugin_id: "manageengine".into(),
            event_type: "ticket.assigned".into(),
            resource_id: "TICKET-456".into(),
            title: "Other ticket".into(),
            summary: "Network down".into(),
            severity: "critical".into(),
            timestamp: Utc::now().to_rfc3339(),
            raw_data: serde_json::json!({}),
        };
        let res3 = bus.publish(ev2);
        assert!(matches!(res3, EventDispatchResult::Accepted(_)));
    }
}
