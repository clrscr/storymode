# Store Mode — CLAUDE.md

## What This Is

A SillyTavern extension that adds narrative tooling to chat: story arcs with phases, author style guidance, scenario blueprints with scenes/beats, and signal-driven story progression.

Loaded by SillyTavern as a `type="module"` script. The `generate_interceptor` (`storeModeGenerateInterceptor`) injects prompt guidance before each generation.

## Module Map

```
index.js              Entry point: sets window.storeModeGenerateInterceptor, calls init()
src/
  constants.js        MODULE_NAME, MODULE_LABEL, defaultSettings, baseUrl (via import.meta.url)
  utils.js            deepClone, makeId, file API helpers (upload/download/delete),
                      dataUrl↔Uint8Array converters, sendProfileRequest
  settings.js         getSettings(), saveSettings(), getChatState(), saveChatState(), seedDefaults()
  png.js              crc32, PNG tEXt chunk encode/insert/extract, embedBlueprintInPng, extractBlueprintFromPng
  prompts.js          buildInjection(), updateExtensionPrompt(), storeModeGenerateInterceptor,
                      buildBeatChecklist(), getPhaseInfo(), getCurrentBeat(), arc/author prompt builders
  timeline.js         renderTimeline() — DOM rendering of scene/beat progress
  export.js           generateBlueprintPngDataUrl(), exportBlueprintPng(), downloadJson(), readJsonFile()
  blueprint.js        upsertBlueprint(), loadBlueprintLibrary(), syncBlueprintToLibrary(),
                      removeBlueprintFromLibrary(), loadBlueprintFromLibrary()
  packs.js            loadPacksIndex(), installPack(), uninstallPack(), renderPacksUI()
  signals.js          parseStorySignals(), onUserMessageRendered(), onMessageReceived(),
                      maybeAutoDetectBeat(), handleCompletionExtras()
  ui.js               renderUI(), bindUI(), init() — full settings panel + event wiring
```

## Dependency Order (bottom-up)

```
constants  utils
    └── settings ──────────────────────┐
    └── png (→ utils)                  │
    └── prompts (→ constants, settings)│
    └── timeline (→ settings, prompts) │
    └── export (→ png)                 │
    └── blueprint (→ utils, settings, png, export)
    └── packs (→ constants, settings, blueprint)
    └── signals (→ settings, prompts, utils)
    └── ui (→ everything)
    └── index.js (→ prompts, ui)
```

No circular dependencies.

## Key Patterns

**SillyTavern context:** All ST APIs accessed via `SillyTavern.getContext()` — never cached at module load time (chat/settings objects change per session).

**Shared state:**
- `extensionSettings[MODULE_NAME]` — persisted user settings (arcs, authors, blueprints, flags)
- `chatMetadata[MODULE_NAME]` — per-chat state (active arc/author/blueprint, beat index, step counter)

**Event system:** Extension hooks into `APP_READY`, `USER_MESSAGE_RENDERED`, `MESSAGE_RECEIVED`, `CHAT_CHANGED` via `eventSource.on(...)`.

**Signal protocol:** LLM can embed `@@BEAT:N@@`, `@@SKIP:N@@`, `@@NEXT_SCENE@@`, `@@STORY_COMPLETE@@` tags in responses to drive beat/scene progression automatically.

**Blueprint library:** Blueprints stored as PNG files (canvas-rendered card + embedded JSON in tEXt chunk) in SillyTavern's `user/files/` directory, with a manifest JSON for indexing.

**baseUrl:** Resolved via `import.meta.url` in `constants.js` — used to fetch seed data and pack files from the extension's own directory.

## Running / Testing

Load SillyTavern, enable the extension from the Extensions panel. No build step required — ESM is loaded natively.

To reload during development: disable and re-enable the extension, or hard-refresh the page.

Seed data lives in `data/story_arcs.json` and `data/author_styles.json` (loaded once on first run). Preset packs are in `data/packs/`.
