use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::Path;
use tatami_desktop_lib::repo::log::fetch_log;

#[napi]
pub fn get_revisions_json(
    repo_path: String,
    limit: u32,
    revset: Option<String>,
    preset: Option<String>,
) -> Result<String> {
    let revisions = fetch_log(
        Path::new(&repo_path),
        limit as usize,
        revset.as_deref(),
        preset.as_deref(),
    )
    .map_err(|error| Error::from_reason(error.to_string()))?;

    serde_json::to_string(&revisions).map_err(|error| Error::from_reason(error.to_string()))
}
