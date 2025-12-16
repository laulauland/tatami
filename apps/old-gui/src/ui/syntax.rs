use std::collections::HashMap;
use std::path::Path;

use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

use super::theme::Colors;

const HIGHLIGHT_NAMES: &[&str] = &[
    "attribute",
    "comment",
    "constant",
    "constant.builtin",
    "constructor",
    "function",
    "function.builtin",
    "keyword",
    "number",
    "operator",
    "property",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "string",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.parameter",
];

#[derive(Clone, Debug)]
pub struct StyledSpan {
    pub text: String,
    pub color: u32,
}

pub struct SyntaxHighlighter {
    highlighter: Highlighter,
    configs: HashMap<String, HighlightConfiguration>,
}

impl SyntaxHighlighter {
    pub fn new() -> Self {
        let mut highlighter = Self {
            highlighter: Highlighter::new(),
            configs: HashMap::new(),
        };
        highlighter.load_languages();
        highlighter
    }

    fn load_languages(&mut self) {
        if let Some(config) = Self::make_rust_config() {
            self.configs.insert("rust".to_string(), config);
        }
        if let Some(config) = Self::make_typescript_config() {
            self.configs.insert("typescript".to_string(), config);
        }
        if let Some(config) = Self::make_typescript_config() {
            self.configs.insert("tsx".to_string(), config);
        }
        if let Some(config) = Self::make_javascript_config() {
            self.configs.insert("javascript".to_string(), config);
        }
        if let Some(config) = Self::make_javascript_config() {
            self.configs.insert("jsx".to_string(), config);
        }
        if let Some(config) = Self::make_python_config() {
            self.configs.insert("python".to_string(), config);
        }
        if let Some(config) = Self::make_json_config() {
            self.configs.insert("json".to_string(), config);
        }
    }

    fn make_rust_config() -> Option<HighlightConfiguration> {
        let mut config = HighlightConfiguration::new(
            tree_sitter_rust::LANGUAGE.into(),
            "rust",
            tree_sitter_rust::HIGHLIGHTS_QUERY,
            tree_sitter_rust::INJECTIONS_QUERY,
            "",
        )
        .ok()?;
        config.configure(HIGHLIGHT_NAMES);
        Some(config)
    }

    fn make_typescript_config() -> Option<HighlightConfiguration> {
        let mut config = HighlightConfiguration::new(
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "typescript",
            tree_sitter_typescript::HIGHLIGHTS_QUERY,
            "",
            tree_sitter_typescript::LOCALS_QUERY,
        )
        .ok()?;
        config.configure(HIGHLIGHT_NAMES);
        Some(config)
    }

    fn make_javascript_config() -> Option<HighlightConfiguration> {
        let mut config = HighlightConfiguration::new(
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "javascript",
            tree_sitter_typescript::HIGHLIGHTS_QUERY,
            "",
            tree_sitter_typescript::LOCALS_QUERY,
        )
        .ok()?;
        config.configure(HIGHLIGHT_NAMES);
        Some(config)
    }

    fn make_python_config() -> Option<HighlightConfiguration> {
        let mut config = HighlightConfiguration::new(
            tree_sitter_python::LANGUAGE.into(),
            "python",
            tree_sitter_python::HIGHLIGHTS_QUERY,
            "",
            "",
        )
        .ok()?;
        config.configure(HIGHLIGHT_NAMES);
        Some(config)
    }

    fn make_json_config() -> Option<HighlightConfiguration> {
        let mut config = HighlightConfiguration::new(
            tree_sitter_json::LANGUAGE.into(),
            "json",
            tree_sitter_json::HIGHLIGHTS_QUERY,
            "",
            "",
        )
        .ok()?;
        config.configure(HIGHLIGHT_NAMES);
        Some(config)
    }

    pub fn detect_language(file_path: &str) -> Option<String> {
        let ext = Path::new(file_path).extension()?.to_str()?;
        match ext {
            "rs" => Some("rust".to_string()),
            "ts" => Some("typescript".to_string()),
            "tsx" => Some("tsx".to_string()),
            "js" => Some("javascript".to_string()),
            "jsx" => Some("jsx".to_string()),
            "py" => Some("python".to_string()),
            "json" => Some("json".to_string()),
            _ => None,
        }
    }

    pub fn highlight_line(&mut self, code: &str, language: &str) -> Vec<StyledSpan> {
        let Some(config) = self.configs.get(language) else {
            return vec![StyledSpan {
                text: code.to_string(),
                color: Colors::TEXT,
            }];
        };

        let Ok(highlights) = self.highlighter.highlight(config, code.as_bytes(), None, |_| None)
        else {
            return vec![StyledSpan {
                text: code.to_string(),
                color: Colors::TEXT,
            }];
        };

        let mut spans = Vec::new();
        let mut current_color = Colors::TEXT;
        let mut color_stack: Vec<u32> = Vec::new();

        for event in highlights.flatten() {
            match event {
                HighlightEvent::Source { start, end } => {
                    if start < end && end <= code.len() {
                        let text = &code[start..end];
                        if !text.is_empty() {
                            spans.push(StyledSpan {
                                text: text.to_string(),
                                color: current_color,
                            });
                        }
                    }
                }
                HighlightEvent::HighlightStart(highlight) => {
                    color_stack.push(current_color);
                    current_color = highlight_to_color(highlight.0);
                }
                HighlightEvent::HighlightEnd => {
                    current_color = color_stack.pop().unwrap_or(Colors::TEXT);
                }
            }
        }

        if spans.is_empty() {
            vec![StyledSpan {
                text: code.to_string(),
                color: Colors::TEXT,
            }]
        } else {
            spans
        }
    }
}

fn highlight_to_color(highlight_index: usize) -> u32 {
    match HIGHLIGHT_NAMES.get(highlight_index) {
        Some(&"attribute") => Colors::SYNTAX_ATTRIBUTE,
        Some(&"comment") => Colors::SYNTAX_COMMENT,
        Some(&"constant") | Some(&"constant.builtin") => Colors::SYNTAX_CONSTANT,
        Some(&"constructor") => Colors::SYNTAX_TYPE,
        Some(&"function") | Some(&"function.builtin") => Colors::SYNTAX_FUNCTION,
        Some(&"keyword") => Colors::SYNTAX_KEYWORD,
        Some(&"number") => Colors::SYNTAX_NUMBER,
        Some(&"operator") => Colors::SYNTAX_OPERATOR,
        Some(&"property") => Colors::SYNTAX_PROPERTY,
        Some(&"punctuation") | Some(&"punctuation.bracket") | Some(&"punctuation.delimiter") => {
            Colors::SYNTAX_PUNCTUATION
        }
        Some(&"string") => Colors::SYNTAX_STRING,
        Some(&"type") | Some(&"type.builtin") => Colors::SYNTAX_TYPE,
        Some(&"variable") | Some(&"variable.builtin") | Some(&"variable.parameter") => {
            Colors::SYNTAX_VARIABLE
        }
        _ => Colors::TEXT,
    }
}
