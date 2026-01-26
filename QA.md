# Store Mode QA Checklist

## Install & Update
- [ ] Install via **Extensions → Install Extension** using `https://github.com/clrscr/storymode`.
- [ ] Open **Extensions → Store Mode** without errors.
- [ ] Use **Check for updates** and verify the extension updates cleanly.

## Story Arcs
- [ ] Story Arc list loads (40+ items visible).
- [ ] Select an arc, edit fields, **Save**, and verify list updates.
- [ ] Set **Arc Length**, click **Apply to chat**, and confirm arc length persists per chat.
- [ ] Toggle **Enable Story Arcs** off/on and confirm prompt preview changes.

## Author Styles
- [ ] Author list loads (40+ items visible).
- [ ] Select an author, edit fields, **Save**, and verify list updates.
- [ ] Toggle **Enable Author Styles** off/on and confirm prompt preview changes.
- [ ] Toggle **NSFW Prompt** and confirm prompt preview includes/excludes NSFW guidance.

## Prompt Injection
- [ ] Enable **Prompt Preview** and confirm it updates when selections change.
- [ ] Adjust **Prompt Priority** and verify no errors.

## Scenario Blueprints
- [ ] Create a new blueprint and edit all structured fields.
- [ ] Add scenes and beats using the editor; **Save** and reload to confirm persistence.
- [ ] Click **Apply to chat** and verify scenario mode activates (Scene/Beat indicator updates).

## Timeline & Beat Checklist
- [ ] Timeline renders scenes and beats.
- [ ] Click a beat in the timeline to jump to it.
- [ ] Beat checklist **Complete** and **Skip** buttons update status.
- [ ] Manual **Next Beat** / **Next Scene** updates checklist and indicator.

## Auto‑Beat Detection
- [ ] Enable **Auto‑Beat** and set threshold.
- [ ] Confirm dialog appears when beat detection triggers (if confirm enabled).
- [ ] Auto‑advance works when enabled.

## Blueprint Wizard
- [ ] Run **Wizard (LLM)** and verify a new blueprint is created.
- [ ] If Connection Manager profile selected, verify it uses that profile.

## Blueprint Library
- [ ] Library loads with grid view and cover thumbnails.
- [ ] **Search**, **Favorites**, **Sort**, and **Grid/List** toggles work.
- [ ] **Open** loads a blueprint into the editor.
- [ ] **Play** applies blueprint to current chat.
- [ ] **New** starts a new chat with the blueprint.

## PNG Export / Import
- [ ] Export blueprint as PNG.
- [ ] Import the PNG and verify blueprint fields are restored.

## Preset Packs
- [ ] Preset pack list loads.
- [ ] Install pack adds story arcs/authors/blueprints.
- [ ] Remove pack deletes only pack‑sourced items.

## Auto‑Extras
- [ ] Enable auto‑epilogue/summary/next and complete an arc.
- [ ] Verify each auto‑extra triggers once.
- [ ] Manual buttons produce outputs when clicked.

## Error Handling
- [ ] Import invalid JSON for arcs/authors/blueprints and verify a warning toast.
- [ ] Import a PNG without metadata and verify warning.

## Persistence & Chat Switching
- [ ] Switch between chats and confirm active selections persist per chat.
- [ ] Reload SillyTavern and confirm settings persist.
