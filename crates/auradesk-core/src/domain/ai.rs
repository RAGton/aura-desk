//! Multi-provider AI domain types, presets, and Aura persona prompt builder.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Supported AI provider backends for Aura.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    Auto,
    OpenAi,
    MiniMax,
    Ollama,
    OpenRouter,
    HermesCli,
    CodexCli,
    Custom,
    Offline,
}

impl AiProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::OpenAi => "openai",
            Self::MiniMax => "minimax",
            Self::Ollama => "ollama",
            Self::OpenRouter => "openrouter",
            Self::HermesCli => "hermes_cli",
            Self::CodexCli => "codex_cli",
            Self::Custom => "custom",
            Self::Offline => "offline",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "openai" | "codex" => Self::OpenAi,
            "minimax" => Self::MiniMax,
            "ollama" => Self::Ollama,
            "openrouter" => Self::OpenRouter,
            "hermes" | "hermes_cli" => Self::HermesCli,
            "codex_cli" => Self::CodexCli,
            "custom" => Self::Custom,
            "offline" => Self::Offline,
            _ => Self::Auto,
        }
    }

    /// Default OpenAI-compatible base URL for HTTP providers.
    pub fn default_base_url(&self) -> Option<&'static str> {
        match self {
            Self::OpenAi => Some("https://api.openai.com/v1"),
            Self::MiniMax => Some("https://api.minimax.io/v1"),
            Self::Ollama => Some("http://127.0.0.1:11434/v1"),
            Self::OpenRouter => Some("https://openrouter.ai/api/v1"),
            _ => None,
        }
    }

    /// Default model identifier for HTTP providers when `ai.model` is empty.
    pub fn default_model(&self) -> Option<&'static str> {
        match self {
            Self::OpenAi => Some("gpt-4.1-mini"),
            Self::MiniMax => Some("MiniMax-M1"),
            Self::Ollama => Some("llama3.2"),
            Self::OpenRouter => Some("openai/gpt-4.1-mini"),
            _ => None,
        }
    }

    /// Whether this provider uses an HTTP OpenAI-compatible `/chat/completions` endpoint.
    pub fn is_http_openai_compatible(&self) -> bool {
        matches!(
            self,
            Self::OpenAi | Self::MiniMax | Self::Ollama | Self::OpenRouter | Self::Custom
        )
    }

    /// Environment variable name checked as fallback when `ai.api_key` setting is blank.
    pub fn env_api_key_name(&self) -> Option<&'static str> {
        match self {
            Self::OpenAi => Some("OPENAI_API_KEY"),
            Self::MiniMax => Some("MINIMAX_API_KEY"),
            Self::OpenRouter => Some("OPENROUTER_API_KEY"),
            Self::Custom => Some("AURA_API_KEY"),
            _ => None,
        }
    }
}

/// Persisted chat message stored in `chat_messages`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub area_id: Option<String>,
    pub created_at: String,
}

/// Input for appending a chat message.
#[derive(Debug, Clone)]
pub struct NewChatMessage {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub area_id: Option<String>,
}

/// Build the system prompt for Aura grounded in live workspace state and optional user persona.
pub fn build_aura_system_prompt(
    locale: &str,
    live_context: &str,
    custom_prompt: Option<&str>,
) -> String {
    let is_en = locale.trim().to_ascii_lowercase().starts_with("en");
    let mut prompt = if is_en {
        String::from(
            "You are Aura, the user's personal AI assistant inside AuraDesk. \
             Be conversational, direct, practical, and honest—offer constructive opinions and \
             proactive tips when you notice a better approach, especially in software engineering, \
             cybersecurity, studies, and daily productivity. Keep answers concise and actionable.",
        )
    } else {
        String::from(
            "Você é a Aura, assistente pessoal de IA do usuário dentro do AuraDesk. \
             Seja conversacional, direta, prática e sincera — dê opiniões construtivas e dicas \
             proativas quando enxergar uma abordagem melhor, especialmente em programação, \
             cibersegurança, estudos e produtividade diária. Mantenha respostas objetivas e úteis.",
        )
    };

    if !live_context.trim().is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(live_context.trim());
    }

    if let Some(extra) = custom_prompt.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\n");
        prompt.push_str(extra);
    }

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_aliases_and_resolves_presets() {
        assert_eq!(AiProviderKind::from_str("codex"), AiProviderKind::OpenAi);
        assert_eq!(AiProviderKind::from_str("MiniMax"), AiProviderKind::MiniMax);
        assert_eq!(
            AiProviderKind::MiniMax.default_base_url(),
            Some("https://api.minimax.io/v1")
        );
        assert_eq!(
            AiProviderKind::Ollama.default_base_url(),
            Some("http://127.0.0.1:11434/v1")
        );
        assert!(AiProviderKind::OpenAi.is_http_openai_compatible());
        assert!(!AiProviderKind::HermesCli.is_http_openai_compatible());
    }

    #[test]
    fn builds_localized_aura_system_prompt_with_live_context() {
        let pt = build_aura_system_prompt("pt-BR", "ctx_pt", Some("persona_rust"));
        assert!(pt.contains("Aura"));
        assert!(pt.contains("ctx_pt"));
        assert!(pt.contains("persona_rust"));

        let en = build_aura_system_prompt("en", "ctx_en", None);
        assert!(en.contains("Aura"));
        assert!(en.contains("ctx_en"));
        assert_ne!(pt, en);
    }
}
