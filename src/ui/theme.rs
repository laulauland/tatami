use gpui::{px, Pixels, SharedString};

const FONT_MONO: &str = "Berkeley Mono";

pub fn font_family() -> SharedString {
    SharedString::from(FONT_MONO)
}

pub struct TextSize;

impl TextSize {
    pub const XS: Pixels = px(10.0);
    pub const SM: Pixels = px(12.0);
    pub const BASE: Pixels = px(13.0);
}

pub struct Colors;

impl Colors {
    // Backgrounds
    pub const BG_BASE: u32 = 0x0d1117;
    pub const BG_SURFACE: u32 = 0x161b22;
    pub const BG_ELEVATED: u32 = 0x21262d;
    pub const BG_HOVER: u32 = 0x30363d;
    pub const BG_SELECTED: u32 = 0x1f6feb;

    // Borders
    pub const BORDER_MUTED: u32 = 0x21262d;

    // Text
    pub const TEXT: u32 = 0xe6edf3;
    pub const TEXT_MUTED: u32 = 0x8b949e;
    pub const TEXT_SUBTLE: u32 = 0x6e7681;

    // Semantic
    pub const ACCENT: u32 = 0x58a6ff;

    // Git status
    pub const ADDED: u32 = 0x3fb950;
    pub const MODIFIED: u32 = 0xd29922;
    pub const DELETED: u32 = 0xf85149;

    // Revision colors
    pub const WORKING_COPY: u32 = 0x58a6ff;
    pub const MUTABLE: u32 = 0xe6edf3;
    pub const IMMUTABLE: u32 = 0x6e7681;
}
