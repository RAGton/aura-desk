-- V015__hindsight_graph_settings.sql
-- Tunables for the knowledge graph and the recall depth. They were
-- hard-coded in the UI before, which made them impossible to change.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('hindsight.graph_node_limit', '60'),
  ('hindsight.recall_top_k', '8');
