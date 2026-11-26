/* ==========================================================================
   NOW OR NEVER — js/game.js
   Loaded FOURTH (after storage.js, questions.js, cards.js). Provides:
     NOW.game   game rules and state. NO DOM ACCESS in this file.

   Owns
   - players (the single source of truth; saved through NOW.storage)
   - settings (loaded / saved through NOW.storage)
   - turn order, round, cards drawn, history, the card currently on the table
   - one shuffled queue of question ids per category

   Queues
   - Fisher-Yates shuffle. A category is not repeated until all of its
     questions were used, then it is reshuffled.
   - Every draw first re-syncs the queue with the questions that are active
     right now, so a deleted or disabled question can never be drawn and a
     newly added one joins the current cycle. rebuildQueues() does the same
     sync for all categories at once.

   Return conventions
   - Actions return { ok: true, ... } or { ok: false, reason, message }.
   - Objects handed out are copies; callers cannot corrupt internal state.
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});

  /* ---------- Constants ---------- */
  const SNAPSHOT_VERSION = 1;
  const HISTORY_MAX = 500; // oldest entries are dropped beyond this
  const RESULTS = ['done', 'skipped', 'passed'];
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  // Messages the UI can show directly (e.g. in #game-warning-text).
  const MESSAGES = {
    'not-enough-players': 'Add at least 2 players to start the game.',
    'not-started': 'The game has not started yet.',
    'card-pending': 'Finish the current card before drawing another one.',
    'no-categories': 'No category has questions available. Turn a category on in Settings or add questions.',
    'no-category-selected': 'Pick a category to draw from.',
    'category-unavailable': 'That category is turned off or has no questions. Pick another one.',
    'no-card': 'There is no card to complete.',
    'invalid-result': 'Unknown result.'
  };

  /* ---------- State ---------- */
  let players = [];
  let settings = null;
  let started = false;
  let turnIndex = 0;
  let round = 1;
  let cardsDrawn = 0;
  let history = [];
  let currentCard = null;
  let lastQuestionId = '';
  let queues = {}; // categoryId -> { queue: string[], used: string[] }

  /* ---------- Dependencies ---------- */

  function store() {
    if (!NOW.storage) throw new Error('NOW.storage is missing. Load js/storage.js first.');
    return NOW.storage;
  }

  function bank() {
    if (!NOW.questions) throw new Error('NOW.questions is missing. Load js/questions.js first.');
    return NOW.questions;
  }

  /* ---------- Small helpers ---------- */

  function fail(reason) {
    return { ok: false, reason: reason, message: MESSAGES[reason] || '' };
  }

  function isId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
  }

  function toInt(value, min, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback;
  }

  function randomInt(count) {
    return Math.floor(Math.random() * count);
  }

  // Fisher-Yates. Returns a new array.
  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function copySettings(source) {
    return {
      disabledCategories: source.disabledCategories.slice(),
      categoryMode: source.categoryMode,
      manualCategory: source.manualCategory,
      allowRepeat: source.allowRepeat
    };
  }

  function copyPlayers(list) {
    return list.map(function (p) { return { id: p.id, name: p.name }; });
  }

  function copyObject(obj) {
    return obj ? Object.assign({}, obj) : null;
  }

  /* ---------- Queues ---------- */

  // Brings a queue entry in line with the ids that are active right now.
  // - ids that are no longer active are dropped (never a stale id)
  // - ids that are new are inserted at a random position of the queue
  // - a missing entry becomes a fresh shuffled queue
  function syncEntry(entry, activeIds) {
    if (!entry) return { queue: shuffle(activeIds), used: [] };

    const active = new Set(activeIds);
    const seen = new Set();
    const queue = [];
    const used = [];

    entry.queue.forEach(function (id) {
      if (active.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
    });
    entry.used.forEach(function (id) {
      if (active.has(id) && !seen.has(id)) { seen.add(id); used.push(id); }
    });
    activeIds.forEach(function (id) {
      if (!seen.has(id)) {
        seen.add(id);
        queue.splice(randomInt(queue.length + 1), 0, id);
      }
    });

    return { queue: queue, used: used };
  }

  // Re-syncs the queue of every category with the currently active questions.
  // Call it after questions are added, edited, enabled, disabled or deleted.
  function rebuildQueues() {
    const next = {};
    bank().getCategories().forEach(function (category) {
      const ids = bank().getAll(category.id).map(function (q) { return q.id; });
      if (!ids.length) return;
      next[category.id] = syncEntry(queues[category.id], ids);
    });
    queues = next;
    return true;
  }

  // Takes the next question of one category, or null when it has none.
  function takeQuestion(categoryId) {
    const active = bank().getAll(categoryId);
    if (!active.length) return null;

    const byId = new Map();
    active.forEach(function (q) { byId.set(q.id, q); });
    const ids = active.map(function (q) { return q.id; });

    // Repeats allowed: plain random pick, but not the same card twice in a row.
    if (settings.allowRepeat) {
      let pool = active;
      if (pool.length > 1) {
        pool = pool.filter(function (q) { return q.id !== lastQuestionId; });
      }
      return pool[randomInt(pool.length)];
    }

    // No repeats: sync first so the queue can never hold a stale id.
    const entry = syncEntry(queues[categoryId], ids);
    queues[categoryId] = entry;

    if (!entry.queue.length) {
      // Every question was used: start a new cycle.
      entry.queue = shuffle(ids);
      entry.used = [];
      if (entry.queue.length > 1 && entry.queue[0] === lastQuestionId) {
        const swapWith = 1 + randomInt(entry.queue.length - 1);
        const tmp = entry.queue[0];
        entry.queue[0] = entry.queue[swapWith];
        entry.queue[swapWith] = tmp;
      }
    }

    const id = entry.queue.shift();
    entry.used.push(id);
    return byId.get(id) || null;
  }

  /* ---------- Categories ---------- */

  // Categories that are switched on AND have at least one active question.
  // Each item: { id, name, color, description, builtIn, count }.
  function getUsableCategories() {
    const disabled = new Set(settings.disabledCategories);
    const usable = [];
    bank().getCategories().forEach(function (category) {
      if (disabled.has(category.id)) return;
      const count = bank().getAll(category.id).length;
      if (count > 0) usable.push(Object.assign({}, category, { count: count }));
    });
    return usable;
  }

  /* ---------- Persistence ---------- */

  function buildSnapshot() {
    const current = players[turnIndex];
    return {
      version: SNAPSHOT_VERSION,
      started: started,
      turnIndex: turnIndex,
      turnPlayerId: current ? current.id : '',
      round: round,
      cardsDrawn: cardsDrawn,
      lastQuestionId: lastQuestionId,
      history: history.map(copyObject),
      currentCard: copyObject(currentCard),
      queues: JSON.parse(JSON.stringify(queues))
    };
  }

  // Saves progress. Returns true when it reached localStorage.
  function saveProgress() {
    try {
      if (!started) return store().clearGame();
      return store().saveGame(buildSnapshot());
    } catch (err) {
      return false;
    }
  }

  function cleanHistoryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = store().cleanText(raw.text, NOW.config.TEXT_MAX);
    if (!text || !isId(raw.category) || RESULTS.indexOf(raw.result) === -1) return null;

    return {
      number: toInt(raw.number, 1, 1),
      questionId: isId(raw.questionId) ? raw.questionId : '',
      category: raw.category,
      categoryName: store().cleanText(raw.categoryName, NOW.config.CATEGORY_NAME_MAX) || raw.category,
      text: text,
      description: store().cleanText(raw.description, NOW.config.DESC_MAX),
      difficulty: NOW.config.DIFFICULTIES.indexOf(raw.difficulty) !== -1 ? raw.difficulty : '',
      playerId: isId(raw.playerId) ? raw.playerId : '',
      playerName: store().cleanText(raw.playerName, NOW.config.NAME_MAX),
      result: raw.result,
      at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0
    };
  }

  function cleanCard(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = store().cleanText(raw.text, NOW.config.TEXT_MAX);
    if (!text || !isId(raw.category) || !isId(raw.playerId)) return null;

    return {
      number: toInt(raw.number, 1, 1),
      id: isId(raw.id) ? raw.id : '',
      category: raw.category,
      categoryName: store().cleanText(raw.categoryName, NOW.config.CATEGORY_NAME_MAX) || raw.category,
      text: text,
      description: store().cleanText(raw.description, NOW.config.DESC_MAX),
      difficulty: NOW.config.DIFFICULTIES.indexOf(raw.difficulty) !== -1 ? raw.difficulty : '',
      custom: raw.custom === true,
      playerId: raw.playerId,
      playerName: store().cleanText(raw.playerName, NOW.config.NAME_MAX)
    };
  }

  function cleanQueues(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (categoryId) {
      const entry = raw[categoryId];
      if (!isId(categoryId) || !entry || typeof entry !== 'object') return;
      const listOf = function (value) {
        return Array.isArray(value) ? value.filter(isId) : [];
      };
      out[categoryId] = { queue: listOf(entry.queue), used: listOf(entry.used) };
    });
    return out;
  }

  function resetProgressState() {
    started = false;
    turnIndex = 0;
    round = 1;
    cardsDrawn = 0;
    history = [];
    currentCard = null;
    lastQuestionId = '';
    queues = {};
  }

  // Restores progress from a saved snapshot. Returns false (and leaves a
  // fresh state) when the snapshot is missing or invalid.
  function restoreSnapshot(snap) {
    resetProgressState();
    if (!snap || typeof snap !== 'object' || snap.version !== SNAPSHOT_VERSION) return false;
    if (typeof snap.started !== 'boolean') return false;

    const restoredHistory = Array.isArray(snap.history)
      ? snap.history.map(cleanHistoryEntry).filter(Boolean).slice(-HISTORY_MAX)
      : [];
    const lastNumber = restoredHistory.length ? restoredHistory[restoredHistory.length - 1].number : 0;

    started = snap.started;
    history = restoredHistory;
    round = toInt(snap.round, 1, 1);
    cardsDrawn = Math.max(toInt(snap.cardsDrawn, 0, 0), lastNumber);
    lastQuestionId = isId(snap.lastQuestionId) ? snap.lastQuestionId : '';

    // Turn: prefer the saved player id, then the saved index, then the first player.
    turnIndex = 0;
    if (players.length) {
      const byId = players.findIndex(function (p) { return p.id === snap.turnPlayerId; });
      if (byId !== -1) turnIndex = byId;
      else if (toInt(snap.turnIndex, 0, -1) !== -1 && snap.turnIndex < players.length) turnIndex = snap.turnIndex;
    }

    // A pending card is only kept if its player still exists.
    const card = cleanCard(snap.currentCard);
    if (card && players.some(function (p) { return p.id === card.playerId; })) {
      currentCard = card;
      cardsDrawn = Math.max(cardsDrawn, card.number);
    }

    queues = cleanQueues(snap.queues);
    return true;
  }

  /* ---------- Setup / lifecycle ---------- */

  // Loads players, settings and saved progress. Safe to call more than once.
  // Returns { restored, started, players, settings }.
  function init() {
    players = store().loadPlayers();
    settings = store().loadSettings();
    if (settings.manualCategory && !bank().hasCategory(settings.manualCategory)) {
      settings.manualCategory = null;
    }

    let restored = false;
    try {
      restored = restoreSnapshot(store().loadGame());
    } catch (err) {
      restored = false;
      resetProgressState();
    }

    if (restored) rebuildQueues(); // drops ids of questions that no longer exist
    return {
      restored: restored,
      started: started,
      players: copyPlayers(players),
      settings: copySettings(settings)
    };
  }

  function ensureInit() {
    if (!settings) init();
  }

  /* ---------- Players ---------- */

  function getPlayers() {
    ensureInit();
    return copyPlayers(players);
  }

  // Replaces the player list (validated and saved). Safe mid-game:
  // - the current player stays current if they are still in the list
  // - if the current player was removed, the turn goes to the player who followed
  // - a drawn card that belonged to a removed player is discarded
  // Returns { players, cardDiscarded, turnPlayerChanged, persisted }.
  function setPlayers(list) {
    ensureInit();
    const previous = players[turnIndex] || null;
    const previousIndex = turnIndex;

    players = store().sanitizePlayers(list);
    const persisted = store().savePlayers(players);

    if (!players.length) {
      turnIndex = 0;
    } else {
      const sameIndex = previous
        ? players.findIndex(function (p) { return p.id === previous.id; })
        : -1;
      if (sameIndex !== -1) turnIndex = sameIndex;
      else turnIndex = previousIndex < players.length ? previousIndex : 0;
    }

    let cardDiscarded = false;
    if (currentCard && !players.some(function (p) { return p.id === currentCard.playerId; })) {
      currentCard = null;
      cardDiscarded = true;
    }

    const now = players[turnIndex] || null;
    saveProgress();
    return {
      players: copyPlayers(players),
      cardDiscarded: cardDiscarded,
      turnPlayerChanged: (previous ? previous.id : '') !== (now ? now.id : ''),
      persisted: persisted
    };
  }

  function getCurrentPlayer() {
    ensureInit();
    return copyObject(players[turnIndex] || null);
  }

  // Everything the turn UI needs:
  // { total, current (1-based, 0 when no players), round, label ("1 / 2"),
  //   player, dots: [{ id, name, state: 'done' | 'current' | 'upcoming' }] }
  function getTurnInfo() {
    ensureInit();
    const total = players.length;
    return {
      total: total,
      current: total ? turnIndex + 1 : 0,
      round: round,
      label: (total ? turnIndex + 1 : 0) + ' / ' + total,
      player: copyObject(players[turnIndex] || null),
      dots: players.map(function (p, i) {
        return {
          id: p.id,
          name: p.name,
          state: i < turnIndex ? 'done' : i === turnIndex ? 'current' : 'upcoming'
        };
      })
    };
  }

  /* ---------- Starting and resetting ---------- */

  // Starts a NEW game with the current players (progress cleared).
  // With { resume: true } an already started game is kept as it is.
  function startGame(options) {
    ensureInit();
    if (players.length < NOW.config.MIN_PLAYERS) return fail('not-enough-players');

    if (options && options.resume === true && started) {
      saveProgress();
      return { ok: true, resumed: true };
    }

    resetProgressState();
    started = true;
    rebuildQueues();
    saveProgress();
    return { ok: true, resumed: false };
  }

  // Clears progress and history. Players and settings are kept.
  // The UI uses this for both "Reset game" and "End game" (after confirming).
  function resetGame() {
    ensureInit();
    resetProgressState();
    store().resetGame();
    return true;
  }

  function isStarted() {
    ensureInit();
    return started;
  }

  // True when there is something worth resuming (a drawn card or finished turns).
  function hasProgress() {
    ensureInit();
    return started && (cardsDrawn > 0 || currentCard !== null);
  }

  /* ---------- Drawing ---------- */

  // { ok: true } when a card can be drawn now, else { ok: false, reason, message }.
  // Reasons: not-enough-players, not-started, card-pending, no-categories,
  //          no-category-selected, category-unavailable.
  function canDraw() {
    ensureInit();
    if (players.length < NOW.config.MIN_PLAYERS) return fail('not-enough-players');
    if (!started) return fail('not-started');
    if (currentCard) return fail('card-pending');

    const usable = getUsableCategories();
    if (!usable.length) return fail('no-categories');

    if (settings.categoryMode === 'manual') {
      if (!settings.manualCategory) return fail('no-category-selected');
      const available = usable.some(function (c) { return c.id === settings.manualCategory; });
      if (!available) return fail('category-unavailable');
    }
    return { ok: true };
  }

  // Draws the next card for the current player.
  // Success: { ok: true, card } with card =
  //   { number, id, category, categoryName, text, description, difficulty,
  //     custom, playerId, playerName }
  // Failure: { ok: false, reason, message } (same reasons as canDraw).
  function drawCard() {
    const check = canDraw();
    if (!check.ok) return check;

    const usable = getUsableCategories();
    const candidates = settings.categoryMode === 'manual'
      ? [settings.manualCategory]
      : shuffle(usable.map(function (c) { return c.id; }));

    let question = null;
    for (let i = 0; i < candidates.length && !question; i += 1) {
      question = takeQuestion(candidates[i]); // a category without a usable question is skipped
    }
    if (!question) return fail(settings.categoryMode === 'manual' ? 'category-unavailable' : 'no-categories');

    const player = players[turnIndex];
    cardsDrawn += 1;
    lastQuestionId = question.id;
    currentCard = {
      number: cardsDrawn,
      id: question.id,
      category: question.category,
      categoryName: bank().categoryName(question.category),
      text: question.text,
      description: question.description || '',
      difficulty: question.difficulty || '',
      custom: question.custom === true,
      playerId: player.id,
      playerName: player.name
    };

    saveProgress();
    return { ok: true, card: copyObject(currentCard) };
  }

  // The card on the table (drawn, not completed yet), or null.
  function getCurrentCard() {
    ensureInit();
    return copyObject(currentCard);
  }

  /* ---------- Finishing a turn ---------- */

  // result: 'done' | 'skipped' | 'passed'. Records the card in the history and
  // moves to the next player.
  // Success: { ok: true, entry, nextPlayer, round, roundChanged }.
  function completeCurrent(result) {
    ensureInit();
    if (RESULTS.indexOf(result) === -1) return fail('invalid-result');
    if (!currentCard) return fail('no-card');

    const entry = {
      number: currentCard.number,
      questionId: currentCard.id,
      category: currentCard.category,
      categoryName: currentCard.categoryName,
      text: currentCard.text,
      description: currentCard.description,
      difficulty: currentCard.difficulty,
      playerId: currentCard.playerId,
      playerName: currentCard.playerName,
      result: result,
      at: Date.now()
    };
    history.push(entry);
    if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
    currentCard = null;

    let roundChanged = false;
    if (players.length) {
      turnIndex += 1;
      if (turnIndex >= players.length) {
        turnIndex = 0;
        round += 1;
        roundChanged = true;
      }
    }

    saveProgress();
    return {
      ok: true,
      entry: copyObject(entry),
      nextPlayer: copyObject(players[turnIndex] || null),
      round: round,
      roundChanged: roundChanged
    };
  }

  /* ---------- Read-only getters ---------- */

  // Oldest first. The UI may reverse it for a "newest first" list.
  function getHistory() {
    ensureInit();
    return history.map(copyObject);
  }

  function getCardsDrawn() {
    ensureInit();
    return cardsDrawn;
  }

  /* ---------- Settings ---------- */

  function getSettings() {
    ensureInit();
    return copySettings(settings);
  }

  // Merges a partial settings object, validates it, saves it and returns the
  // new settings. Fields: disabledCategories, categoryMode, manualCategory, allowRepeat.
  function updateSettings(patch) {
    ensureInit();
    const merged = Object.assign({}, settings, patch && typeof patch === 'object' ? patch : {});
    const next = store().sanitizeSettings(merged);
    if (next.manualCategory && !bank().hasCategory(next.manualCategory)) {
      next.manualCategory = null;
    }

    settings = next;
    store().saveSettings(settings);
    rebuildQueues();
    saveProgress();
    return copySettings(settings);
  }

  /* ---------- Public API ---------- */
  NOW.game = Object.freeze({
    init: init,

    // players and turns
    setPlayers: setPlayers,
    getPlayers: getPlayers,
    getCurrentPlayer: getCurrentPlayer,
    getTurnInfo: getTurnInfo,

    // lifecycle
    startGame: startGame,
    resetGame: resetGame,
    isStarted: isStarted,
    hasProgress: hasProgress,

    // cards
    canDraw: canDraw,
    drawCard: drawCard,
    getCurrentCard: getCurrentCard,
    completeCurrent: completeCurrent,

    // data
    getHistory: getHistory,
    getCardsDrawn: getCardsDrawn,
    getUsableCategories: getUsableCategories,

    // settings and queues
    getSettings: getSettings,
    updateSettings: updateSettings,
    rebuildQueues: rebuildQueues
  });
})(window);
