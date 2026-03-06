import { getSettings, getChatState, saveChatState } from './settings.js';
import { getCurrentBeat, buildInjection, updateExtensionPrompt } from './prompts.js';
import { sendProfileRequest } from './utils.js';

function parseStorySignals(text) {
  const signals = [];
  let cleanText = text;
  const patterns = [
    { type: 'BEAT', regex: /@@BEAT:(\d+)@@/g },
    { type: 'SKIP', regex: /@@SKIP:(\d+)@@/g },
    { type: 'NEXT_SCENE', regex: /@@NEXT_SCENE@@/g },
    { type: 'STORY_COMPLETE', regex: /@@STORY_COMPLETE@@/g }
  ];
  patterns.forEach((pattern) => {
    const matches = [...cleanText.matchAll(pattern.regex)];
    matches.forEach((match) => {
      signals.push({ type: pattern.type, value: match[1] });
    });
    cleanText = cleanText.replace(pattern.regex, '');
  });
  return { cleanText: cleanText.trim(), signals };
}

async function pushSystemMessage(text) {
  const ctx = SillyTavern.getContext();
  if (typeof ctx.addOneMessage === 'function') {
    ctx.addOneMessage({
      is_user: false,
      is_system: true,
      name: 'Store Mode',
      send_date: Date.now(),
      mes: text
    });
    return;
  }
  if (ctx.Popup && ctx.Popup.show && ctx.Popup.show.text) {
    await ctx.Popup.show.text('Store Mode', text);
    return;
  }
  window.alert(text);
}

async function generateQuiet(mode) {
  const { generateQuietPrompt } = SillyTavern.getContext();
  const instructions = {
    summary: 'Generate a concise summary of the story so far.',
    epilogue: 'Write a short epilogue that closes the current story arc.',
    next: 'Suggest what should happen next in the story.'
  };
  const quietPrompt = instructions[mode];
  if (!quietPrompt) return '';
  const settings = getSettings();
  if (settings.llmProfiles.extras) {
    const response = await sendProfileRequest(settings.llmProfiles.extras, quietPrompt, 512);
    if (response) return response;
  }
  const result = await generateQuietPrompt({ quietPrompt });
  return typeof result === 'string' ? result : (result && (result.response || result.text || result.output)) || '';
}

async function handleCompletionExtras() {
  const settings = getSettings();
  const state = getChatState();
  if (!settings.featureFlags.extras || !state.storyComplete) return;

  if (settings.extrasOptions.autoSummary && !state.summaryDone) {
    const result = await generateQuiet('summary');
    if (result) await pushSystemMessage(result);
    state.summaryDone = true;
  }
  if (settings.extrasOptions.autoEpilogue && !state.epilogueDone) {
    const result = await generateQuiet('epilogue');
    if (result) await pushSystemMessage(result);
    state.epilogueDone = true;
  }
  if (settings.extrasOptions.autoNext && !state.nextDone) {
    const result = await generateQuiet('next');
    if (result) await pushSystemMessage(result);
    state.nextDone = true;
  }
  await saveChatState();
}

export async function maybeAutoDetectBeat(text) {
  const settings = getSettings();
  const state = getChatState();
  const blueprint = settings.blueprints.find(item => item.id === state.activeBlueprintId);
  if (!blueprint) return;
  const beat = getCurrentBeat(blueprint, state.currentBeatIndex);
  if (!beat) return;

  const prompt = `Decide if the current beat is complete. Respond with JSON: {"complete": true/false, "confidence": 0-1, "reason": "..."}.\nBeat goal: ${beat.goal || ''}\nBeat prompt: ${beat.prompt || ''}\nMessage: ${text}`;

  let response = '';
  if (settings.llmProfiles.blueprint) {
    response = await sendProfileRequest(settings.llmProfiles.blueprint, prompt, 200);
  }
  if (!response) return;
  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch (err) {
    return;
  }
  const confidence = Number(parsed.confidence || 0);
  if (confidence < settings.autoBeat.threshold) return;
  if (!parsed.complete) return;

  if (settings.autoBeat.confirm) {
    const ok = window.confirm(`Mark beat complete?\n${beat.label || beat.goal || ''}\nReason: ${parsed.reason || ''}`);
    if (!ok) return;
  }

  if (!state.beatState) state.beatState = {};
  const key = `${state.currentSceneIndex || 0}:${state.currentBeatIndex}`;
  state.beatState[key] = 'complete';
  if (settings.autoBeat.autoAdvance) {
    state.currentBeatIndex += 1;
  }
  await saveChatState();
  updateExtensionPrompt();
}

export async function onUserMessageRendered() {
  const settings = getSettings();
  if (!settings.enabled || !settings.featureFlags.storyArcs) return;
  const state = getChatState();
  if (!state.activeArcId || state.pacingMode !== 'story') return;
  if (state.storyComplete) return;
  state.currentStep = (state.currentStep || 0) + 1;
  if (state.currentStep >= state.arcLength) {
    state.storyComplete = true;
  }
  await saveChatState();
  updateExtensionPrompt();
  const panel = document.getElementById('store-mode-settings');
  if (panel) {
    const checklist = panel.querySelector('#store-mode-blueprint-checklist');
    if (checklist) {
      checklist.dispatchEvent(new Event('storemode-refresh', { bubbles: true }));
    }
  }
  if (state.storyComplete) {
    handleCompletionExtras().catch(err => console.warn('[Store Mode] Auto extras failed', err));
  }
}

export async function onMessageReceived(messageId) {
  const settings = getSettings();
  if (!settings.enabled) return;
  const state = getChatState();
  if (state.pacingMode !== 'scenario') return;

  const ctx = SillyTavern.getContext();
  const chat = ctx.chat;
  if (!chat || typeof messageId !== 'number') return;
  const message = chat[messageId];
  if (!message) return;

  const text = message.mes || message.text || '';
  const { cleanText, signals } = parseStorySignals(text);
  if (!signals.length && settings.autoBeat.enabled) {
    await maybeAutoDetectBeat(text);
    return;
  }
  if (!signals.length) return;

  message.mes = cleanText;
  if (ctx.saveChatConditional) {
    ctx.saveChatConditional();
  } else if (ctx.saveMetadata) {
    await ctx.saveMetadata();
  }

  signals.forEach((signal) => {
    if (signal.type === 'BEAT' || signal.type === 'SKIP') {
      const beatIndex = Math.max(parseInt(signal.value || '0', 10), 0);
      state.currentBeatIndex = Math.max(state.currentBeatIndex || 0, beatIndex);
      const key = `${state.currentSceneIndex || 0}:${beatIndex}`;
      if (!state.beatState) state.beatState = {};
      state.beatState[key] = signal.type === 'SKIP' ? 'skipped' : 'complete';
    }
    if (signal.type === 'NEXT_SCENE') {
      state.currentSceneIndex = (state.currentSceneIndex || 0) + 1;
      state.currentBeatIndex = 0;
    }
    if (signal.type === 'STORY_COMPLETE') {
      state.storyComplete = true;
    }
  });

  await saveChatState();
  updateExtensionPrompt();
  if (state.storyComplete) {
    handleCompletionExtras().catch(err => console.warn('[Store Mode] Auto extras failed', err));
  }
}
