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
  assets/
    icons/ (optional)
  README.md
```

## Manifest Requirements
- `display_name`: “Store Mode”
- `js`: `index.js`
- `css`: `style.css` (optional)
- `author`, `version`
- `minimum_client_version` (set once validated)
- `generate_interceptor`: true (if using prompt interception)

## Data Model
### extensionSettings (global defaults)
- `storeMode.enabled` (bool)
- `storeMode.storyArcs` (array of arc objects)
- `storeMode.authorStyles` (array of author objects)
- `storeMode.featureFlags` (toggles: arcs, authors, blueprints, extras)
- `storeMode.llmProfiles` (per-feature profile selection)
- `storeMode.ui` (view prefs, last selected tab)

### chatMetadata (per-chat state)
- `storeMode.activeArcId` (string or null)
- `storeMode.activeAuthorId` (string or null)
- `storeMode.activeBlueprintId` (string or null)
- `storeMode.currentBeatIndex` (number)
- `storeMode.sessionNotes` (optional)

### Blueprint schema (JSON)
```
{
  "id": "uuid",
  "title": "string",
  "logline": "string",
  "genre": "string",
  "scenes": [
    {
      "title": "string",
      "beats": [
        {"label": "string", "goal": "string", "prompt": "string"}
      ]
    }
  ],
  "coverImage": "dataURL or path",
  "meta": {"createdAt": "ISO", "author": "string"}
}
```

## Feature Details
### 1) Story Arcs
- CRUD list with title, description, tone notes, pacing notes, tropes, do/don’t.
- Toggle active arc per chat; stored in `chatMetadata`.
- Prompt injection: include arc summary in a dedicated instruction block.

### 2) Author Mimicry
- CRUD list with name, style notes, typical vocabulary, sentence structure hints.
- Mixable with any Story Arc; prompt merges arc + author sections.
- Optional “strength” slider (light → strong).

### 3) Scenario Blueprints
- Wizard flow: inputs (title/logline/genre/length/beat model) → LLM generates blueprint → validate schema → save.
- Beat tracking: for each message, inject the current beat hint and advance on user action.
- Export: JSON + PNG card (rendered preview) for sharing.

### 4) Extras
- Auto‑epilogue: triggered when blueprint marked complete.
- Summaries: on demand or periodic (e.g., every N scenes).
- “What’s Next”: generate continuation hooks.
- Per‑feature LLM profiles (defaults in settings; overrides per chat optional).

## UI/UX Plan
- Add a new settings panel under Extensions.
- Tabs: **Story Arcs**, **Author Styles**, **Scenario Blueprints**, **Extras/Settings**.
- Each list has create/edit/delete, import/export JSON, enable/disable.
- Blueprint editor: left list of scenes/beats, right details.
- Toolbar actions: “Apply to chat”, “Clear selection”, “Export JSON/PNG”.

## Prompt Assembly & Injection
- Use `SillyTavern.getContext()` to access chat and settings.
- Build a structured instruction block:
  - Arc section (if enabled)
  - Author section (if enabled)
  - Blueprint beat section (if enabled)
- Use `generate_interceptor` to inject into system or analysis role per SillyTavern guidance.

## External Integration
- Optional SD image extension support: if present, offer “Generate Covers” (max 10) and attach to blueprint.
- Avoid external CDNs; keep dependencies local or native.

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
- Completed: Library grid + play/open flow, beat checklist UI, prompt preview/priority, profile selectors, import validation, theme tuning, play new chat.
- Pending: Step 8 (QA/install verification).

## Testing Checklist
- Install/enable extension from Git URL without errors.
- Select arc + author + blueprint and verify prompt injection.
- Remove/disable features and confirm no injection.
- Export/import blueprint JSON and validate schema integrity.
- PNG export renders correctly.
- Beat tracking advances and persists across reloads.
