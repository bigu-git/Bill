/* ==========================================================================
   NOW OR NEVER — js/cards.js
   Loaded THIRD (after storage.js and questions.js). Provides:
     NOW.cards   fills the static card in index.html and drives its states

   The card DOM is static in index.html; this file never creates it.
   States (data-state on #card): idle -> flipping -> revealed -> resetting -> idle

   Rules
   - Text goes in with textContent only (never innerHTML).
   - "animationend" bubbles up from the card's children (text-in), so the
     listener only accepts the card's own flip / unflip animation.
   - Every animation also has a timeout fallback, so the card can never get
     stuck (hidden screen, reduced motion, missing animationend).
   - Tapping the card is wired in app.js, not here.
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});

  /* ---------- Constants ---------- */
  const STATES = ['idle', 'flipping', 'revealed', 'resetting'];
  const FLIP_FALLBACK_MS = 1100;   // CSS flip lasts ~950ms
  const RESET_FALLBACK_MS = 600;   // CSS unflip lasts ~500ms
  const REDUCED_FALLBACK_MS = 120; // reduced motion: animations take ~0ms
  const LONG_TEXT = 90;            // text longer than this gets .is-long
  const XLONG_TEXT = 140;          // text longer than this also gets .is-xlong
  const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  // Translated text (NOW.i18n is optional: English is the fallback).
  function say(key, params, fallback) {
    try {
      if (NOW.i18n && NOW.i18n.exists(key)) return NOW.i18n.t(key, params);
    } catch (err) { /* use the fallback */ }
    return fallback;
  }

  function difficultyLabel(id) {
    return say('diff.' + id, null, DIFFICULTY_LABELS[id] || '');
  }
  const CUSTOM_VARS = ['--cat', '--cat-ink', '--cat-accent', '--cat-edge'];

  /* ---------- Element cache (grabbed once) ---------- */
  let els = null;

  function grab() {
    if (els) return els;
    const doc = global.document;
    const card = doc.getElementById('card');
    if (!card) return null; // markup missing: every public function degrades safely

    els = {
      card: card,
      front: doc.getElementById('card-front'),
      category: doc.getElementById('card-category'),
      number: doc.getElementById('card-number'),
      text: doc.getElementById('card-text'),
      note: doc.getElementById('card-note'),
      difficulty: doc.getElementById('card-difficulty'),
      live: doc.getElementById('card-live')
    };
    return els;
  }

  /* ---------- Internal flags ---------- */
  let busy = false;          // true while a flip / unflip (or a chained pair) runs
  let pending = Promise.resolve(true); // the operation currently running

  /* ---------- Small helpers ---------- */

  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  function readState() {
    const card = grab() && els.card;
    const value = card ? card.dataset.state : '';
    return STATES.indexOf(value) !== -1 ? value : 'idle';
  }

  function setState(next) {
    if (grab()) els.card.dataset.state = next;
  }

  function flatten(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  // Relative luminance (0 dark .. 1 light) of #rgb / #rrggbb. Returns null when not a hex color.
  function luminance(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // Resolves after the card's own animation `name` ends, or after the fallback timeout.
  function waitForAnimation(name, fallbackMs) {
    return new Promise(function (resolve) {
      const card = els.card;
      let finished = false;
      let timer = null;

      function finish() {
        if (finished) return;
        finished = true;
        card.removeEventListener('animationend', onEnd);
        card.removeEventListener('animationcancel', onEnd);
        if (timer !== null) global.clearTimeout(timer);
        resolve();
      }

      function onEnd(event) {
        // Ignore children (e.g. "text-in") and other animations of the card.
        if (event.target === card && event.animationName === name) finish();
      }

      card.addEventListener('animationend', onEnd);
      card.addEventListener('animationcancel', onEnd);
      timer = global.setTimeout(finish, prefersReducedMotion() ? REDUCED_FALLBACK_MS : fallbackMs);
    });
  }

  /* ---------- Input normalising ---------- */

  // Returns a clean card description, or null when there is nothing to show.
  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    const text = flatten(data.text);
    if (!text) return null;

    const categoryId = typeof data.category === 'string' ? data.category.trim() : '';
    const number = Number(data.number);

    return {
      categoryId: categoryId,
      text: text,
      description: flatten(data.description),
      difficulty: DIFFICULTY_LABELS[data.difficulty] ? data.difficulty : '',
      number: Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
    };
  }

  function lookupCategory(id) {
    try {
      if (NOW.questions && typeof NOW.questions.getCategory === 'function') {
        return NOW.questions.getCategory(id);
      }
    } catch (err) {
      // fall through to the safe default
    }
    return { id: id || 'unknown', name: id || 'Unknown', color: '', builtIn: false, unknown: true };
  }

  /* ---------- Rendering ---------- */

  // Built-in categories are themed by CSS ([data-cat]). Custom categories
  // carry their own color, so the CSS variables are set inline.
  function applyCategory(category) {
    const card = els.card;
    card.dataset.cat = category.id || '';

    const needsInline = !category.builtIn && !category.unknown && luminance(category.color) !== null;
    if (!needsInline) {
      CUSTOM_VARS.forEach(function (name) { card.style.removeProperty(name); });
      return;
    }

    const light = luminance(category.color) > 0.55;
    card.style.setProperty('--cat', category.color);
    card.style.setProperty('--cat-accent', category.color);
    card.style.setProperty('--cat-ink', light ? '#171717' : '#ffffff');
    card.style.setProperty('--cat-edge', light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.16)');
  }

  function applyTextSize(length) {
    els.text.classList.toggle('is-long', length > LONG_TEXT);
    els.text.classList.toggle('is-xlong', length > XLONG_TEXT);
  }

  // Fills the (currently hidden) front face. Returns the category used.
  function fillFront(info) {
    const category = lookupCategory(info.categoryId);
    applyCategory(category);

    if (els.category) els.category.textContent = category.name;
    if (els.number) els.number.textContent = info.number ? '#' + info.number : '';

    els.text.textContent = info.text;
    applyTextSize(Array.from(info.text).length);

    if (els.note) {
      els.note.textContent = info.description;
      els.note.hidden = !info.description;
    }

    if (els.difficulty) {
      els.difficulty.textContent = info.difficulty ? difficultyLabel(info.difficulty) : '';
      els.difficulty.hidden = !info.difficulty;
    }

    if (els.front) els.front.setAttribute('aria-hidden', 'true'); // hidden from screen readers until revealed
    return category;
  }

  function buildAnnouncement(info, category) {
    const parts = [];
    if (info.number) parts.push(say('card.n', { n: info.number }, 'Card ' + info.number + '.'));
    parts.push(category.name + '.');
    parts.push(info.text);
    if (info.description) parts.push(info.description);
    if (info.difficulty) {
      const label = difficultyLabel(info.difficulty);
      parts.push(say('card.difficulty', { d: label }, 'Difficulty: ' + label + '.'));
    }
    return parts.join(' ');
  }

  function setLive(message) {
    if (els.live) els.live.textContent = message;
  }

  /* ---------- Transitions (internal, no busy checks) ---------- */

  function runFlip(info) {
    const category = fillFront(info);
    setLive('');
    setState('flipping');

    return waitForAnimation('card-flip', FLIP_FALLBACK_MS).then(function () {
      setState('revealed');
      if (els.front) els.front.removeAttribute('aria-hidden');
      setLive(buildAnnouncement(info, category));
      return true;
    });
  }

  function runUnflip() {
    setLive('');
    if (els.front) els.front.setAttribute('aria-hidden', 'true');
    setState('resetting');

    return waitForAnimation('card-unflip', RESET_FALLBACK_MS).then(function () {
      setState('idle');
      // The front is hidden again: safe to drop the previous theme.
      els.card.dataset.cat = '';
      CUSTOM_VARS.forEach(function (name) { els.card.style.removeProperty(name); });
      return true;
    });
  }

  // Runs one transition while holding the busy flag. Never rejects.
  function run(task) {
    busy = true;
    let started;
    try {
      started = Promise.resolve(task()); // starts now, so data-state changes immediately
    } catch (err) {
      started = Promise.resolve(false);
    }
    pending = started
      .catch(function () { return false; })
      .then(function (result) {
        busy = false;
        return result;
      });
    return pending;
  }

  // A state left over from a crash or a manual edit (flipping / resetting with
  // no operation running) is snapped to its resting state so nothing sticks.
  function recoverStuckState() {
    if (busy) return;
    const state = readState();
    if (state === 'flipping') setState('revealed');
    else if (state === 'resetting') setState('idle');
  }

  /* ---------- Public API ---------- */

  // Flips the card and shows `data`:
  //   { category, text, description, difficulty, number }
  // Resolves true when the flip has finished, false when ignored
  // (busy, missing card element, or empty text). Never rejects.
  // If a card is already revealed it is turned back first.
  function showCard(data) {
    if (!grab()) return Promise.resolve(false);
    const info = normalize(data);
    if (!info) return Promise.resolve(false);
    if (busy) return Promise.resolve(false); // double-tap guard

    recoverStuckState();

    if (readState() === 'revealed') {
      return run(function () {
        return runUnflip().then(function () { return runFlip(info); });
      });
    }
    return run(function () { return runFlip(info); });
  }

  // Turns the card face down. Resolves true once it is idle (also when it
  // already was). If a flip is still running it waits for it, then resets.
  function resetCard() {
    if (!grab()) return Promise.resolve(false);
    if (busy) {
      return pending.then(function () { return resetCard(); });
    }

    recoverStuckState();
    if (readState() === 'idle') return Promise.resolve(true);
    return run(runUnflip);
  }

  // True while the card is animating (use it to disable buttons).
  function isBusy() {
    return busy;
  }

  // 'idle' | 'flipping' | 'revealed' | 'resetting'
  function getState() {
    return readState();
  }

  NOW.cards = Object.freeze({
    showCard: showCard,
    resetCard: resetCard,
    isBusy: isBusy,
    getState: getState
  });

  // Scripts are deferred, so the markup exists now; grab the elements early.
  grab();
})(window);
