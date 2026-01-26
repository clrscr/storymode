# Store Mode (SillyTavern Extension)

Store Mode adds narrative tooling to SillyTavern: Story Arcs, Author Styles, Scenario Blueprints with beat tracking, a blueprint library, auto‑extras, and preset packs.

## Install
1) In SillyTavern: **Extensions → Install Extension**
2) Paste this repo URL: `https://github.com/clrscr/storymode`
3) Store Mode appears in **Extensions → Store Mode**

## Quick Start
1) Open **Extensions → Store Mode**
2) Pick a **Story Arc** and/or **Author Style**
3) (Optional) Create or load a **Scenario Blueprint**
4) Click **Apply to chat** and start chatting

## Features & How To Use

### Story Arcs (Genres)
- Pick a genre preset to guide tone, pacing, tropes, and phase prompts.
- Set **Arc Length** (message count) to control progression across phases.
- **Apply to chat** saves the selection per‑chat.

### Author Styles
- Choose a writing style preset (e.g., Hemingway, Austen).
- Toggle **NSFW Prompt** if you want optional mature‑style guidance.

### Scenario Blueprints
- Use **Blueprints** for structured, multi‑scene stories.
- **Wizard (LLM)** can generate a blueprint from a title/logline/genre.
- Edit blueprint fields and scenes using the form editor (no raw JSON needed).
- **Apply to chat** sets scenario mode and resets scene/beat counters.

### Beat Tracking
- Manual: Use **Next Beat** / **Next Scene**.
- Signal‑based: the model can emit `@@BEAT:N@@`, `@@NEXT_SCENE@@`, `@@STORY_COMPLETE@@` at the end of responses.
- Checklist shows each beat with **complete/skip** controls.

### Timeline View
- Timeline lists scenes and beats with status markers.
- Click a beat to jump to it (updates current scene/beat).

### Blueprint Library
- **Grid/List** view with search, favorites, and sorting.
- **Open** loads a blueprint into the editor.
- **Play** applies it to the current chat.
- **New** starts a new chat with the blueprint (and opening message if present).

### PNG Export / Import
- **Export PNG** embeds blueprint JSON metadata inside the PNG.
- **Import PNG** loads blueprint data from the embedded metadata.

### Preset Packs
- One‑click install for bundled Story Arcs, Author Styles, and Blueprints.
- Installed items are tracked and removable by pack.

### Auto‑Extras (Epilogue / Summary / What’s Next)
- Enable in **Extras** to auto‑generate on story completion.
- Manual buttons are available any time.

### Auto‑Beat Detection (Optional)
- Detects beat completion from AI output using a small LLM check.
- Configure **threshold** and **confirmation** before applying.
- Optional **auto‑advance** to move to the next beat on completion.

### Prompt Preview & Priority
- **Prompt Preview** shows what the extension injects.
- **Priority** controls ordering against other extensions.

### LLM Profiles (Connection Manager)
- If Connection Manager is installed, select per‑feature profiles:
  - Arcs, Authors, Blueprints, Extras

## Data & Storage
- Story Arcs and Author Styles seed from `data/story_arcs.json` and `data/author_styles.json` on first run.
- Blueprints are stored in the file API as PNGs with metadata plus a manifest:
  - `/user/files/storymode-manifest.json`
  - `/user/files/storymode-bp-<id>.png`

## Tips
- You can use **only** Story Arcs, **only** Author Styles, both, or neither.
- For best scenario tracking, encourage the model to emit beat signals at the end of responses.

## Troubleshooting
- If lists are empty after install, update the extension and reopen Store Mode.
- If PNG import fails, ensure the PNG was exported by Store Mode.
- If profile dropdowns are empty, install/enable Connection Manager.

## Known Issues
- Auto‑Beat Detection relies on LLM output and can be conservative; lower the threshold if it never triggers.
- PNG import only works with files exported by Store Mode (embedded metadata).
- Connection Manager profiles are optional; when missing, features fall back to default API calls.

## Changelog
- **0.2.3**
  - Added Blueprint Timeline view and Auto‑Beat Detection.
  - Added Preset Packs (starter Noir pack included).
  - Enhanced blueprint library UI (grid, favorites, sort, play new chat).
- **0.2.2**
  - Added structured blueprint editor, beat checklist UI, and profile selectors.
  - Added Play in new chat and import validation/toasts.
- **0.2.1**
  - Added library grid + play/open workflow and prompt preview.
- **0.2.0**
  - Added library search, beat checklist in prompt, and prompt priority controls.

## License
TBD
