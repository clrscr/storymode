import { MODULE_NAME } from './constants.js';
import { getSettings, getChatState } from './settings.js';

export function getArcName(arc) {
  return arc.name || arc.title || '';
}

export function buildStoryPrompt(arc) {
  const parts = [
    arc.storyPrompt,
    arc.guidance,
    arc.tone ? `Tone: ${arc.tone}` : '',
    arc.pacing ? `Pacing: ${arc.pacing}` : '',
    arc.tropes ? `Tropes: ${arc.tropes}` : '',
    arc.genre ? `Genre: ${arc.genre}` : '',
    Array.isArray(arc.category) ? `Category: ${arc.category.join(', ')}` : ''
  ].filter(Boolean);
  return parts.join(' ');
}

export function buildAuthorPrompt(author) {
  const parts = [
    author.authorPrompt,
    author.style,
    author.voice,
    author.notes,
    Array.isArray(author.keywords) ? `Keywords: ${author.keywords.join(', ')}` : ''
  ].filter(Boolean);
  return parts.join(' ');
}

export function getPhaseInfo(currentStep, arcLength) {
  const safeLength = Math.max(arcLength || 1, 1);
  const step = Math.max(currentStep || 0, 0);
  const arcPercent = Math.min(Math.round((step / safeLength) * 100), 100);
  const phase = arcPercent < 34 ? 'setup' : arcPercent < 67 ? 'confrontation' : 'resolution';
  const totalInPhase = Math.ceil(safeLength / 3);
  const positionInPhase = Math.min(step % totalInPhase, totalInPhase);
  const phasePercent = Math.min(Math.round((positionInPhase / totalInPhase) * 100), 100);
  return {
    currentStep: step,
    arcLength: safeLength,
    arcPercent,
    phase,
    positionInPhase,
    totalInPhase,
    phasePercent
  };
}

export function formatProgress(template, phaseInfo) {
  if (!template) return '';
  return template
    .replace('{currentStep}', phaseInfo.currentStep)
    .replace('{arcLength}', phaseInfo.arcLength)
    .replace('{arcPercent}', phaseInfo.arcPercent)
    .replace('{phase}', phaseInfo.phase)
    .replace('{positionInPhase}', phaseInfo.positionInPhase)
    .replace('{totalInPhase}', phaseInfo.totalInPhase)
    .replace('{phasePercent}', phaseInfo.phasePercent);
}

export function getCurrentBeat(blueprint, beatIndex) {
  if (!blueprint || !Array.isArray(blueprint.scenes)) return null;
  const beats = blueprint.scenes.flatMap(scene => scene.beats || []);
  if (!beats.length) return null;
  return beats[Math.min(beatIndex, beats.length - 1)];
}

export function buildBeatChecklist(blueprint, state) {
  if (!blueprint || !Array.isArray(blueprint.scenes)) return '';
  const lines = [];
  blueprint.scenes.forEach((scene, sceneIndex) => {
    lines.push(`Scene ${sceneIndex + 1}: ${scene.title || ''}`.trim());
    (scene.beats || []).forEach((beat, beatIndex) => {
      const key = `${sceneIndex}:${beatIndex}`;
      const status = (state.beatState && state.beatState[key]) || 'pending';
      const marker = status === 'complete' ? '✓' : status === 'skipped' ? 'x' : '→';
      lines.push(`  [${marker}] ${beat.label || beat.title || 'Beat'}: ${beat.goal || beat.prompt || ''}`.trim());
    });
  });
  return lines.join('\n');
}

export function buildInjection() {
  const settings = getSettings();
  if (!settings.enabled) return '';

  const state = getChatState();
  const arc = settings.storyArcs.find(item => item.id === state.activeArcId);
  const author = settings.authorStyles.find(item => item.id === state.activeAuthorId);
  const blueprint = settings.blueprints.find(item => item.id === state.activeBlueprintId);

  const sections = [];
  if (settings.featureFlags.storyArcs && arc) {
    const phaseInfo = getPhaseInfo(state.currentStep, state.arcLength);
    const storyPrompt = arc.storyPrompt || buildStoryPrompt(arc);
    const phasePrompt = arc.phasePrompts ? arc.phasePrompts[phaseInfo.phase] : '';
    const progressLine = formatProgress(arc.progressTemplate, phaseInfo);

    sections.push([
      `Story Type\nName: ${getArcName(arc)}`,
      storyPrompt ? `Story Prompt: ${storyPrompt}` : '',
      phasePrompt ? `Phase Prompt (${phaseInfo.phase}): ${phasePrompt}` : '',
      progressLine ? progressLine : ''
    ].filter(Boolean).join('\n'));
  }
  if (settings.featureFlags.authorStyles && author) {
    const prompt = author.authorPrompt || buildAuthorPrompt(author);
    const nsfw = settings.nsfwAuthorStyle && author.nsfwPrompt ? `NSFW Guidance: ${author.nsfwPrompt}` : '';
    sections.push([
      `Author Style\nName: ${author.name || ''}`,
      prompt ? `Author Prompt: ${prompt}` : '',
      nsfw
    ].filter(Boolean).join('\n'));
  }
  if (settings.featureFlags.blueprints && blueprint) {
    const beat = getCurrentBeat(blueprint, state.currentBeatIndex);
    if (beat) {
      const signalHint = state.pacingMode === 'scenario'
        ? 'Use @@BEAT:N@@, @@NEXT_SCENE@@, @@STORY_COMPLETE@@ signals at the end of responses.'
        : '';
      const checklist = buildBeatChecklist(blueprint, state);
      const details = [
        blueprint.core_premise ? `Premise: ${blueprint.core_premise}` : '',
        blueprint.setting ? `Setting: ${[blueprint.setting.location, blueprint.setting.time_period, blueprint.setting.atmosphere].filter(Boolean).join(' | ')}` : '',
        blueprint.protagonist_group?.description ? `Protagonists: ${blueprint.protagonist_group.description}` : '',
        blueprint.antagonistic_forces?.description ? `Antagonists: ${blueprint.antagonistic_forces.description}` : '',
        blueprint.arc_structure?.description ? `Arc: ${blueprint.arc_structure.description}` : '',
        blueprint.tone_and_style?.description ? `Tone: ${blueprint.tone_and_style.description}` : '',
        blueprint.content_boundaries ? `Boundaries: ${blueprint.content_boundaries}` : ''
      ].filter(Boolean).join('\n');
      sections.push(`Scenario Blueprint\nTitle: ${blueprint.title || ''}\n${details}\nCurrent Beat: ${beat.label || ''}\nGoal: ${beat.goal || ''}\nPrompt: ${beat.prompt || ''}\n${signalHint}\n${checklist ? `Checklist:\n${checklist}` : ''}`.trim());
    }
  }

  if (!sections.length) return '';
  return `Store Mode Guidance\n\n${sections.join('\n\n')}`;
}

export function updateExtensionPrompt() {
  const ctx = SillyTavern.getContext();
  const settings = getSettings();
  const injection = buildInjection();
  const panel = document.getElementById('store-mode-settings');
  if (panel) {
    const previewToggle = panel.querySelector('#store-mode-flag-preview');
    const previewArea = panel.querySelector('#store-mode-prompt-preview');
    if (previewToggle && previewArea && previewToggle.checked) {
      previewArea.value = injection;
    }
  }
  if (typeof ctx.setExtensionPrompt === 'function') {
    if (ctx.extension_prompt_types && ctx.extension_prompt_roles) {
      ctx.setExtensionPrompt(
        MODULE_NAME,
        injection,
        ctx.extension_prompt_types.CHAT,
        ctx.extension_prompt_roles.SYSTEM,
        settings.promptOptions.priority || 10
      );
    } else {
      ctx.setExtensionPrompt(MODULE_NAME, injection);
    }
  }
  if (panel) {
    const checklist = panel.querySelector('#store-mode-blueprint-checklist');
    if (checklist) {
      checklist.dispatchEvent(new Event('storemode-refresh', { bubbles: true }));
    }
  }
}

export async function storeModeGenerateInterceptor(chat, contextSize, abort, type) {
  if (type === 'quiet') return;
  const injection = buildInjection();
  if (!injection) return;

  const systemNote = {
    is_user: false,
    is_system: true,
    name: 'Store Mode',
    send_date: Date.now(),
    mes: injection
  };

  const insertIndex = Math.max(chat.length - 1, 0);
  chat.splice(insertIndex, 0, systemNote);
}
