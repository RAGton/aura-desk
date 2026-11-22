-- V011__raglight_settings.sql
-- RAGLight local/cloud connection and managed provisioning settings.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('raglight.enabled', 'false'),
  ('raglight.mode', '"managed_local"'),
  ('raglight.base_url', '"http://127.0.0.1:8000"'),
  ('raglight.api_key', '""'),
  ('raglight.provider', '"ollama"'),
  ('raglight.embedding_model', '"nomic-embed-text"'),
  ('raglight.llm_model', '"qwen3:0.6b"'),
  ('raglight.vector_store', '"chroma"'),
  ('raglight.folders', '""');
