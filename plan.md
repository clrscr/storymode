# Store Mode Extension Plan (SillyTavern)

## Goal
Build a plain-JS SillyTavern extension that is importable via the “Install extension” Git URL flow and provides:
- Story Arcs (genre/tone/pacing guides) with CRUD and optional prompt injection.
- Author Mimicry (style guides) with CRUD and optional prompt injection.
- Scenario Blueprints (multi-scene, beat-tracked story plans) with a wizard to generate via LLM, plus JSON/PNG share/export.
- Extras: auto-epilogues, summaries, “What’s Next”, and per-feature LLM profile selection.

## Constraints & Targets
- Must load cleanly as a third‑party extension (`/scripts/extensions/third-party/<ExtensionName>`).
- Plain JS/HTML/CSS (no bundler).
- Ship 40 Story Arcs and a starter Author set as JSON files in the repo for first‑run import.
- Optional features: users can enable none, one, or both (arcs + author styles).

## Repository Structure
```
store-mode/
  manifest.json
  index.js
  style.css
  data/
    story_arcs.json
    author_styles.json
    blueprints_samples.json (optional)
    packs/
      index.json
      noir-starter.json
  assets/
    icons/ (optional)
  README.md
```

## Feature Summary (Implemented)
- Story Arcs with phase prompts and arc length progression.
- Author Styles with optional NSFW prompt support.
- Scenario Blueprints with structured editor, wizard, and beat tracking.
- Blueprint library with grid/list, favorites, sorting, play/open/new chat.
- PNG export/import with embedded metadata.
- Timeline view + beat checklist UI.
- Auto‑extras (epilogue, summary, next).
- Auto‑beat detection with threshold + confirmation.
- Prompt preview + priority.
- Connection Manager profile selectors.
- Preset packs with one‑click install/remove.

## Implementation Steps
1) Scaffold repo with `manifest.json`, `index.js`, `style.css`, `data/*.json`, README.
2) Create data loaders to seed defaults into `extensionSettings` on first run.
3) Build UI shell + tabs + list CRUD for arcs/authors.
4) Add scenario blueprint wizard and editor UI.
5) Implement prompt injection + beat tracking.
6) Implement export (JSON + PNG) and import flows.
7) Extras (auto‑epilogue, summaries, “What’s Next”).
8) QA: test install via Git URL; verify persistence across chats and sessions.

## Progress
- Completed: Steps 1–7 (scaffold, seeding/helpers, UI, prompt injection, wizard, export/import, extras).
- Completed: Seeded 40 Story Arcs + 40 Author Styles.
- Completed: Alignment with Prompt-And-Circumstance/StoryMode (schema fields, phase prompts, arc length tracking, signal parsing, setExtensionPrompt injection, file-backed blueprint manifest, PNG metadata embed/extract, auto-epilogue/summary).
- Completed: Library grid + play/open/new, beat checklist UI, prompt preview/priority, profile selectors, import validation, theme tuning, preset packs, auto‑beat, timeline view.
- Pending: Step 8 (QA/install verification in SillyTavern).

## Testing Checklist
- Install/enable extension from Git URL without errors.
- Select arc + author + blueprint and verify prompt injection.
- Remove/disable features and confirm no injection.
- Export/import blueprint JSON and validate schema integrity.
- PNG export/import retains embedded metadata.
- Beat tracking advances and persists across reloads.
- Auto‑extras trigger at completion when enabled.
- Auto‑beat detection works with confirmation toggle.
- Blueprint library actions (open/play/new) work as expected.
