/* ==========================================================================
   NOW OR NEVER — js/storage.js
   Loaded FIRST. Provides:
     NOW.config   shared limits (players, text lengths, difficulties)
     NOW.storage  safe localStorage wrapper + typed load/save helpers

   Design notes
   - Every value is stored as JSON: { v: <schema version>, data: <value> }.
   - Reads never throw. Bad or missing data returns a safe default.
   - Every loader sanitizes what it reads, so corrupted or hand-edited
     localStorage can never crash the game.
   - If localStorage is blocked (private mode, quota, disabled), the app
     keeps working from an in-memory copy for the current session.
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});

  /* ---------- Shared configuration ---------- */
  const config = Object.freeze({
    STORAGE_PREFIX: 'nonv1:',
    SCHEMA_VERSION: 1,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 12,
    NAME_MAX: 20,
    TEXT_MAX: 200,
    DESC_MAX: 120,
    CATEGORY_NAME_MAX: 24,
    DIFFICULTIES: Object.freeze(['', 'easy', 'medium', 'hard'])
  });
  NOW.config = config;

  /* localStorage key names (the prefix is added automatically) */
  const KEYS = Object.freeze({
    players: 'players',
    settings: 'settings',
    custom: 'custom',
    categories: 'categories',
    game: 'game'
  });

  /* ---------- Backend: memory cache + localStorage ---------- */
  // The memory map is the source of truth during a session.
  // A null value means "removed", so a failed removeItem never resurrects old data.
  const memory = new Map();
  let lastError = null;

  function detectStorage() {
    try {
      const probe = config.STORAGE_PREFIX + '__probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      lastError = err;
      return false;
    }
  }

  let persistent = detectStorage();

  function fullKey(name) {
    return config.STORAGE_PREFIX + name;
  }

  function readRaw(name) {
    const key = fullKey(name);
    if (memory.has(key)) return memory.get(key);
    let text = null;
    if (persistent) {
      try {
        text = global.localStorage.getItem(key);
      } catch (err) {
        lastError = err;
      }
    }
    memory.set(key, text);
    return text;
  }

  function writeRaw(name, text) {
    const key = fullKey(name);
    memory.set(key, text);
    if (!persistent) return false;
    try {
      global.localStorage.setItem(key, text);
      return true;
    } catch (err) {
      lastError = err; // e.g. quota exceeded: keep working from memory
      return false;
    }
  }

  /* ---------- Generic get / set / remove ---------- */

  // Returns the stored value, or `fallback` when missing, corrupted, or from another schema version.
  function get(name, fallback) {
    const safeFallback = fallback === undefined ? null : fallback;
    const text = readRaw(name);
    if (text === null || text === undefined) return safeFallback;
    try {
      const wrapped = JSON.parse(text);
      if (
        wrapped &&
        typeof wrapped === 'object' &&
        wrapped.v === config.SCHEMA_VERSION &&
        Object.prototype.hasOwnProperty.call(wrapped, 'data')
      ) {
        return wrapped.data;
      }
    } catch (err) {
      lastError = err;
    }
    return safeFallback;
  }

  // Returns true if the value reached localStorage, false if it is memory-only.
  function set(name, value) {
    let text;
    try {
      text = JSON.stringify({ v: config.SCHEMA_VERSION, data: value });
    } catch (err) {
      lastError = err;
      return false;
    }
    return writeRaw(name, text);
  }

  function remove(name) {
    const key = fullKey(name);
    memory.set(key, null);
    if (!persistent) return true;
    try {
      global.localStorage.removeItem(key);
      return true;
    } catch (err) {
      lastError = err;
      return false;
    }
  }

  // Removes every key that belongs to this app.
  function clearAll() {
    Object.keys(KEYS).forEach(function (k) { remove(KEYS[k]); });
    if (!persistent) return;
    try {
      const stale = [];
      for (let i = 0; i < global.localStorage.length; i += 1) {
        const key = global.localStorage.key(i);
        if (key && key.indexOf(config.STORAGE_PREFIX) === 0) stale.push(key);
      }
      stale.forEach(function (key) {
        global.localStorage.removeItem(key);
        memory.set(key, null);
      });
    } catch (err) {
      lastError = err;
    }
  }

  /* ---------- Sanitizing helpers ---------- */

  // Collapses whitespace, trims, and cuts to `max` characters (emoji-safe).
  function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    const flat = value.replace(/\s+/g, ' ').trim();
    if (!max) return flat;
    return Array.from(flat).slice(0, max).join('');
  }

  // Only simple ids are accepted: letters, digits, "_" and "-".
  function cleanId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
  }

  function cleanColor(value) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '';
  }

  // Unique id, e.g. "q_lq3x9a2k4f7z"
  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rand;
  }

  /* ---------- Players ---------- */
  // Player: { id, name }

  function sanitizePlayers(list) {
    if (!Array.isArray(list)) return [];
    const seenNames = new Set();
    const seenIds = new Set();
    const out = [];

    list.forEach(function (item) {
      if (out.length >= config.MAX_PLAYERS) return;
      const src = typeof item === 'string' ? { name: item } : item || {};
      const name = cleanText(src.name, config.NAME_MAX);
      if (!name) return;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) return;

      let id = cleanId(src.id);
      if (!id || seenIds.has(id)) id = uid('p');

      seenNames.add(nameKey);
      seenIds.add(id);
      out.push({ id: id, name: name });
    });

    return out;
  }

  function loadPlayers() {
    return sanitizePlayers(get(KEYS.players, []));
  }

  function savePlayers(players) {
    return set(KEYS.players, sanitizePlayers(players));
  }

  /* ---------- Settings ---------- */
  // Settings: {
  //   disabledCategories: string[]   (empty = every category enabled)
  //   categoryMode: 'random' | 'manual'
  //   manualCategory: string | null  (last chosen category in manual mode)
  //   allowRepeat: boolean
  // }

  function getDefaultSettings() {
    return {
      disabledCategories: [],
      categoryMode: 'random',
      manualCategory: null,
      allowRepeat: false
    };
  }

  function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const disabled = Array.isArray(src.disabledCategories)
      ? src.disabledCategories.map(cleanId).filter(Boolean)
      : [];

    return {
      disabledCategories: Array.from(new Set(disabled)),
      categoryMode: src.categoryMode === 'manual' ? 'manual' : 'random',
      manualCategory: cleanId(src.manualCategory) || null,
      allowRepeat: src.allowRepeat === true
    };
  }

  function loadSettings() {
    return sanitizeSettings(get(KEYS.settings, getDefaultSettings()));
  }

  function saveSettings(settings) {
    return set(KEYS.settings, sanitizeSettings(settings));
  }

  /* ---------- Custom questions ---------- */
  // Question: { id, category, text, description, difficulty, enabled, custom: true, createdAt }

  // Returns a clean question object, or null when text/category are missing.
  function sanitizeQuestion(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = cleanText(raw.text, config.TEXT_MAX);
    const category = cleanId(raw.category);
    if (!text || !category) return null;

    return {
      id: cleanId(raw.id) || uid('q'),
      category: category,
      text: text,
      description: cleanText(raw.description, config.DESC_MAX),
      difficulty: config.DIFFICULTIES.indexOf(raw.difficulty) !== -1 ? raw.difficulty : '',
      enabled: raw.enabled !== false,
      custom: true,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
    };
  }

  function sanitizeQuestions(list) {
    if (!Array.isArray(list)) return [];
    const seenIds = new Set();
    const out = [];

    list.forEach(function (item) {
      const question = sanitizeQuestion(item);
      if (!question) return;
      if (seenIds.has(question.id)) question.id = uid('q');
      seenIds.add(question.id);
      out.push(question);
    });

    return out;
  }

  function loadCustomQuestions() {
    return sanitizeQuestions(get(KEYS.custom, []));
  }

  function saveCustomQuestions(list) {
    return set(KEYS.custom, sanitizeQuestions(list));
  }

  /* ---------- Custom categories (reserved for future use) ---------- */
  // Category: { id, name, color, description }
  // The MVP has no UI for this, but the storage layer is ready for it.

  function sanitizeCategories(list) {
    if (!Array.isArray(list)) return [];
    const seenIds = new Set();
    const out = [];

    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const id = cleanId(item.id);
      const name = cleanText(item.name, config.CATEGORY_NAME_MAX);
      const color = cleanColor(item.color);
      if (!id || !name || !color || seenIds.has(id)) return;
      seenIds.add(id);
      out.push({
        id: id,
        name: name,
        color: color,
        description: cleanText(item.description, config.DESC_MAX)
      });
    });

    return out;
  }

  function loadCustomCategories() {
    return sanitizeCategories(get(KEYS.categories, []));
  }

  function saveCustomCategories(list) {
    return set(KEYS.categories, sanitizeCategories(list));
  }

  /* ---------- Game progress snapshot ---------- */
  // game.js decides the shape (turn, history, drawn counters, deck queues).
  // Here we only guarantee it is a plain object or null.

  function loadGame() {
    const data = get(KEYS.game, null);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  }

  function saveGame(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    return set(KEYS.game, state);
  }

  function clearGame() {
    return remove(KEYS.game);
  }

  /* ---------- Resets (used by the Settings screen) ---------- */

  // "Reset game": clears progress and history. Players and settings are kept.
  function resetGame() {
    return clearGame();
  }

  // "Reset custom questions": deletes every question the user created.
  function resetCustomQuestions() {
    return remove(KEYS.custom);
  }

  // Wipes everything this app stored.
  function resetAll() {
    clearAll();
  }

  /* ---------- Status ---------- */

  // false means data lives only in memory and will be lost on refresh.
  function isPersistent() {
    return persistent;
  }

  function getLastError() {
    return lastError;
  }

  /* ---------- Public API ---------- */
  NOW.storage = Object.freeze({
    KEYS: KEYS,

    // generic
    get: get,
    set: set,
    remove: remove,
    clearAll: clearAll,
    isPersistent: isPersistent,
    getLastError: getLastError,

    // helpers shared with other modules
    uid: uid,
    cleanText: cleanText,

    // players
    sanitizePlayers: sanitizePlayers,
    loadPlayers: loadPlayers,
    savePlayers: savePlayers,

    // settings
    getDefaultSettings: getDefaultSettings,
    sanitizeSettings: sanitizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,

    // custom questions
    sanitizeQuestion: sanitizeQuestion,
    loadCustomQuestions: loadCustomQuestions,
    saveCustomQuestions: saveCustomQuestions,

    // custom categories (reserved)
    loadCustomCategories: loadCustomCategories,
    saveCustomCategories: saveCustomCategories,

    // game progress
    loadGame: loadGame,
    saveGame: saveGame,
    clearGame: clearGame,

    // resets
    resetGame: resetGame,
    resetCustomQuestions: resetCustomQuestions,
    resetAll: resetAll
  });
})(window);
