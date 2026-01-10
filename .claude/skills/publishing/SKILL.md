---
name: publishing
description: Tatami publishing workflow (GitHub Actions + tauri-action), and the exact rules for building GitHub release notes from commit bodies (jj-friendly).
---

# Tatami Publishing (GitHub Actions)

Source of truth: `.github/workflows/release.yml`.

## Publishing: what happens (1–3)

1) **Push triggers workflow**
- Any push to `main` triggers the workflow (also runnable via `workflow_dispatch`).
- Concurrency is enabled with `cancel-in-progress: true`, so a newer push to `main` cancels any in-flight run for `main`.

2) **Prepare release metadata**
- Computes the tag and name:
  - Tag: `nightly-<github.run_number>`
  - Name: `Nightly <github.run_number>`
- Generates `releaseBody` by parsing commit bodies since the last `nightly-*` tag (details below).
  - If the last `nightly-*` tag is not an ancestor of `HEAD` (e.g. `main` rewritten), it falls back to commits since that tag’s committer timestamp.

3) **Build + publish (macOS-only)**
- Runs on `macos-latest` only.
- Uses `tauri-apps/tauri-action` to build `apps/desktop` and publish/attach artifacts to a GitHub Release.
- Releases are marked as prereleases.

## Release notes: exactly what gets included

Release notes are generated from commit **bodies** only (never from commit subjects).

### Opt-in section

Only content under a commit-body heading line matching exactly:

- `## RN:`
- `## RN`

is included.

The RN section starts *after* that heading line.

### Where the RN section ends

The RN section ends at the first subsequent markdown heading line that matches:

- `## <something>`

(i.e. the next H2 heading).

### Trailers are excluded

Before parsing the RN section, the workflow strips commit trailers at the end of the commit body.

A “trailer” is any line matching:

- `Key: value`

and any blank lines immediately above trailers.

### Dedupe (jj-friendly)

Because `jj` history may be rewritten and hashes are not stable, dedupe is not hash-based.

- If the RN section contains a line `RN-ID: <stable-id>`, that id is used as the dedupe key.
  - The `RN-ID:` line itself is removed from the published notes.
- Otherwise, the entire RN markdown content is used as the dedupe key.

### Empty notes behavior

If no commits in the selected range contain an RN section, the release body includes:

- `_No release notes in this push. Add a ## RN: section to commit bodies._`

## Example commit message

```text
feat: improve diff viewer

Details that won’t be included.

## RN:
- Add syntax highlighting for unified diffs
- Fix scroll position when switching files
RN-ID: diff-viewer-v1

Co-authored-by: Someone <x@y.z>
```

Included in release notes:

- The two bullet points under `## RN:` (without the `RN-ID:` line)

Excluded:

- Everything outside `## RN:`
- Trailers like `Co-authored-by:`

## Files to edit

- Workflow: `.github/workflows/release.yml`
- Docs: `README.md` (publishing + RN convention)
