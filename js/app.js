/* ==========================================================================
   NOW OR NEVER — js/app.js  (Phase 9)
   Loaded LAST. Wires the static HTML to NOW.storage / NOW.questions /
   NOW.cards / NOW.game. This file is one IIFE split into 3 parts:
     part 1  helpers, toast, dialogs, navigation, setup (players)
     part 2  game screen, card flow, history dialog
     part 3  creator, settings, event binding, startup
   User text is only ever written with textContent / createElement.
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});
  const doc = global.document;

  /* ---------- Constants ---------- */
  const SCREENS = ['home', 'setup', 'game', 'creator', 'settings', 'howto'];
  const LEAVE_MS = 220;          // matches .screen.is-leaving animation
  const NAME_CHANGE_MS = 500;    // matches .is-changing animation
  const REMOVE_MS = 200;         // matches .player-item.is-removing animation
  const TOAST_MS = 2600;
  const TOAST_LEAVE_MS = 250;
  const MIN_QUESTION_CHARS = 3;
  // Translated text for a key (js/i18n.js holds the dictionaries).
  function t(key, params) {
    return NOW.i18n.t(key, params);
  }

  function resultLabel(result) {
    return result === 'done' || result === 'skipped' || result === 'passed' ? t('result.' + result) : result;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- UI state (never persisted; game data lives in NOW.game) ---------- */
  const ui = {
    screen: 'home',
    locked: false,          // true while a draw / complete flow is running
    cardShown: false,       // true once the drawn card finished flipping
    shownPlayerId: '',      // last player name rendered (to animate changes)
    editingId: '',          // custom question being edited ('' = new)
    removing: new Set(),    // player ids currently fading out
    toastTimer: 0,
    toastHideTimer: 0,
    leaveTimer: 0,
    nameTimer: 0,
    started: false          // boot() ran
  };

  // Element cache, filled once by cacheElements() (part 3).
  const el = {};

  /* ---------- Small DOM helpers ---------- */

  function byId(id) {
    return doc.getElementById(id);
  }

  // Creates an element; options: className, text, attrs{}, dataset{}.
  function make(tag, options) {
    const node = doc.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (key) { node.setAttribute(key, opts.attrs[key]); });
    }
    if (opts.dataset) {
      Object.keys(opts.dataset).forEach(function (key) { node.dataset[key] = opts.dataset[key]; });
    }
    return node;
  }

  // <svg class="icon"><use href="#icon-NAME"></use></svg>
  function makeIcon(name) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = doc.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-' + name);
    svg.appendChild(use);
    return svg;
  }

  function makeIconButton(iconName, label, extraClass) {
    const btn = make('button', {
      className: 'icon-btn icon-btn--sm' + (extraClass ? ' ' + extraClass : ''),
      attrs: { type: 'button', 'aria-label': label }
    });
    btn.appendChild(makeIcon(iconName));
    return btn;
  }

  function clearChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  // Built-in categories are themed by CSS through [data-cat]. Custom
  // categories carry their own color, so the CSS variables are set inline.
  function applyCategoryTheme(node, category) {
    node.dataset.cat = category.id || '';
    if (!category || category.builtIn || category.unknown || !isHexColor(category.color)) return;

    const hex = category.color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
    node.style.setProperty('--cat', category.color);
    node.style.setProperty('--cat-accent', category.color);
    node.style.setProperty('--cat-ink', light ? '#171717' : '#ffffff');
  }

  // Count with its noun in the current language: plural(3, 'card') -> "3 cards".
  function plural(count, word) {
    return NOW.i18n.plural('n.' + word.replace(' ', '_'), count);
  }

  // Shows an inline error (form-error element) and marks an input as invalid.
  function showFieldError(errorNode, message, inputNode) {
    errorNode.textContent = message;
    errorNode.hidden = false;
    if (inputNode) {
      inputNode.classList.remove('is-invalid');
      void inputNode.offsetWidth; // restart the shake animation
      inputNode.classList.add('is-invalid');
      inputNode.setAttribute('aria-invalid', 'true');
    }
  }

  function clearFieldError(errorNode, inputNodes) {
    errorNode.hidden = true;
    errorNode.textContent = '';
    (inputNodes || []).forEach(function (node) {
      if (!node) return;
      node.classList.remove('is-invalid');
      node.removeAttribute('aria-invalid');
    });
  }

  /* ---------- Toast ---------- */

  // Shows a short message. A new toast replaces the current one.
  function showToast(message, duration) {
    const toast = el.toast;
    if (!toast || !message) return;

    global.clearTimeout(ui.toastTimer);
    global.clearTimeout(ui.toastHideTimer);
    toast.classList.remove('is-leaving');
    toast.textContent = String(message);
    toast.hidden = false;

    ui.toastTimer = global.setTimeout(hideToast, duration || TOAST_MS);
  }

  function hideToast() {
    const toast = el.toast;
    if (!toast || toast.hidden) return;
    toast.classList.add('is-leaving');
    ui.toastHideTimer = global.setTimeout(function () {
      toast.hidden = true;
      toast.classList.remove('is-leaving');
    }, prefersReducedMotion() ? 0 : TOAST_LEAVE_MS);
  }

  /* ---------- Dialog helpers ---------- */

  function openDialog(dialog) {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  // Generic two-button dialog. Resolves with 'ok', 'cancel' or 'dismiss'
  // (Escape). options: title, message, okLabel, cancelLabel, danger (default true).
  function askDialog(options) {
    const opts = options || {};
    const dialog = el.confirmDialog;

    return new Promise(function (resolve) {
      // No <dialog> support or already open: fall back safely.
      if (!dialog || typeof dialog.showModal !== 'function') {
        const text = (opts.title ? opts.title + '\n\n' : '') + (opts.message || '');
        let answer = false;
        try { answer = global.confirm(text); } catch (err) { answer = false; }
        resolve(answer ? 'ok' : 'cancel');
        return;
      }
      if (dialog.open) {
        resolve('dismiss');
        return;
      }

      const danger = opts.danger !== false;
      el.confirmTitle.textContent = opts.title || t('confirm.title');
      el.confirmMessage.textContent = opts.message || t('confirm.msg');
      el.confirmOk.textContent = opts.okLabel || t('confirm.ok');
      el.confirmCancel.textContent = opts.cancelLabel || t('confirm.cancel');
      el.confirmOk.classList.toggle('btn--danger', danger);
      el.confirmOk.classList.toggle('btn--primary', !danger);

      dialog.returnValue = ''; // Escape leaves this empty => 'dismiss'
      dialog.addEventListener('close', function onClose() {
        dialog.removeEventListener('close', onClose);
        const value = dialog.returnValue;
        resolve(value === 'ok' ? 'ok' : value === 'cancel' ? 'cancel' : 'dismiss');
      });
      openDialog(dialog);
    });
  }

  // Yes/no helper used by every destructive action. Resolves true only on OK.
  function confirmAction(options) {
    return askDialog(options).then(function (answer) { return answer === 'ok'; });
  }

  /* ---------- Navigation ---------- */

  // Switches the visible screen with the leave/enter transition.
  function showScreen(name) {
    if (SCREENS.indexOf(name) === -1) return false;
    const target = byId('screen-' + name);
    if (!target) return false;
    if (ui.screen === name && target.classList.contains('is-active')) return true;

    // Finish any previous leave animation immediately.
    global.clearTimeout(ui.leaveTimer);
    el.screens.forEach(function (screen) { screen.classList.remove('is-leaving'); });

    const leaving = el.screens.filter(function (screen) {
      return screen !== target && screen.classList.contains('is-active');
    });
    leaving.forEach(function (screen) {
      screen.classList.remove('is-active');
      screen.classList.add('is-leaving');
    });
    ui.leaveTimer = global.setTimeout(function () {
      leaving.forEach(function (screen) { screen.classList.remove('is-leaving'); });
    }, LEAVE_MS);

    target.classList.add('is-active');
    ui.screen = name;
    try { global.scrollTo(0, 0); } catch (err) { /* ignore */ }

    runScreenEnter(name);
    focusScreenHeading(target);
    return true;
  }

  // Refreshes the content of the screen that was just opened.
  function runScreenEnter(name) {
    try {
      if (name === 'setup') renderSetup();
      else if (name === 'game') onEnterGame();
      else if (name === 'creator') renderCreator();
      else if (name === 'settings') renderSettings();
    } catch (err) {
      reportError(t('err.screen'), err);
    }
  }

  // Keyboard users land on the screen title; pointer users see no ring.
  function focusScreenHeading(screen) {
    const heading = screen.querySelector('h1, h2');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    try { heading.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }

  // Entry point for every [data-goto] element and internal navigation.
  function navigate(name, trigger) {
    if (name === 'game') {
      openGame();
      return;
    }
    if (name === 'setup' && trigger && trigger.id === 'btn-play') {
      playFlow();
      return;
    }
    showScreen(name);
  }

  // Opens the game screen only when a started game with enough players exists.
  function openGame() {
    const players = NOW.game.getPlayers();
    if (!NOW.game.isStarted() || players.length < NOW.config.MIN_PLAYERS) {
      showScreen('setup');
      return;
    }
    showScreen('game');
  }

  // PLAY button: when a game with progress exists, offer to resume it.
  // Resuming never wipes anything; "Set up new game" only opens setup, the
  // old progress is replaced when Start game is pressed (and confirmed).
  function playFlow() {
    const game = NOW.game;
    const canResume = game.hasProgress() && game.getPlayers().length >= NOW.config.MIN_PLAYERS;
    if (!canResume) {
      showScreen('setup');
      return;
    }

    askDialog({
      title: t('play.title'),
      message: t('play.msg', { cards: plural(game.getCardsDrawn(), 'card') }),
      okLabel: t('play.ok'),
      cancelLabel: t('play.cancel'),
      danger: false
    }).then(function (answer) {
      if (answer === 'ok') {
        const res = game.startGame({ resume: true });
        if (!res.ok) {
          showToast(res.message);
          showScreen('setup');
          return;
        }
        showScreen('game');
      } else if (answer === 'cancel') {
        showScreen('setup');
      }
      // 'dismiss' (Escape): stay where we are
    });
  }

  /* ---------- Error reporting ---------- */

  // Logs the technical error and tells the player in plain words.
  function reportError(message, err) {
    try { console.error('[NOW OR NEVER] ' + message, err || ''); } catch (e) { /* ignore */ }
    showToast(message, 4000);
  }

  /* ---------- Setup screen (players) ---------- */

  function renderSetup() {
    renderPlayers();
    clearFieldError(el.playerError, [el.playerInput]);
  }

  function renderPlayers() {
    const players = NOW.game.getPlayers();
    const max = NOW.config.MAX_PLAYERS;
    const min = NOW.config.MIN_PLAYERS;

    clearChildren(el.playerList);
    players.forEach(function (player, index) {
      const item = make('li', { className: 'player-item', dataset: { id: player.id } });
      if (ui.removing.has(player.id)) item.classList.add('is-removing');
      item.appendChild(make('span', { className: 'player-item__index', text: index + 1 }));
      item.appendChild(make('span', { className: 'player-item__name', text: player.name }));
      item.appendChild(makeIconButton('trash', t('player.remove', { name: player.name }), 'icon-btn--danger'));
      el.playerList.appendChild(item);
    });

    el.playerCount.textContent = players.length + ' / ' + max;
    el.playerEmpty.hidden = players.length > 0;

    const full = players.length >= max;
    el.playerInput.disabled = full;
    el.btnAddPlayer.disabled = full;
    el.playerInput.placeholder = full ? t('setup.limit') : t('setup.name');

    const ready = players.length >= min;
    el.btnStartGame.disabled = !ready;
    // With no players the lead text already states the rule, so the hint stays hidden.
    el.setupHint.hidden = players.length === 0;
    if (ready) {
      el.setupHint.textContent = t('setup.ready', { players: plural(players.length, 'player') });
    } else if (players.length) {
      el.setupHint.textContent = t('setup.need_more', { more: plural(min - players.length, 'more player') });
    }
  }

  // Saves a new player list through NOW.game.setPlayers and fixes the UI.
  function commitPlayers(list) {
    const result = NOW.game.setPlayers(list);
    if (result.cardDiscarded) {
      // The drawn card belonged to a removed player: put the card back.
      ui.cardShown = false;
      NOW.cards.resetCard();
      showToast(t('toast.discarded'));
    }
    if (!result.persisted) warnNotPersisted();
    return result;
  }

  function warnNotPersisted() {
    showToast(t('toast.storage_changes'), 4500);
  }

  function handlePlayerSubmit(event) {
    event.preventDefault();
    clearFieldError(el.playerError, [el.playerInput]);

    const name = NOW.storage.cleanText(el.playerInput.value, NOW.config.NAME_MAX);
    const players = NOW.game.getPlayers();

    if (!name) {
      showFieldError(el.playerError, t('setup.err.empty'), el.playerInput);
      el.playerInput.focus();
      return;
    }
    if (players.length >= NOW.config.MAX_PLAYERS) {
      showFieldError(el.playerError, t('setup.err.max', { max: NOW.config.MAX_PLAYERS }), el.playerInput);
      return;
    }
    const lower = name.toLowerCase();
    const duplicate = players.some(function (p) { return p.name.toLowerCase() === lower; });
    if (duplicate) {
      showFieldError(el.playerError, t('setup.err.dup', { name: name }), el.playerInput);
      el.playerInput.focus();
      el.playerInput.select();
      return;
    }

    const next = players.concat([{ id: NOW.storage.uid('p'), name: name }]);
    commitPlayers(next);
    el.playerInput.value = '';
    renderPlayers();
    el.playerInput.focus();
  }

  function handlePlayerListClick(event) {
    const button = event.target.closest('button');
    if (!button || !el.playerList.contains(button)) return;
    const item = button.closest('.player-item');
    const id = item ? item.dataset.id : '';
    if (!id || ui.removing.has(id)) return;

    ui.removing.add(id);
    item.classList.add('is-removing');

    global.setTimeout(function () {
      ui.removing.delete(id);
      const left = NOW.game.getPlayers().filter(function (p) { return p.id !== id; });
      commitPlayers(left);
      renderPlayers();
      clearFieldError(el.playerError, [el.playerInput]);
    }, prefersReducedMotion() ? 0 : REMOVE_MS);
  }

  // START GAME: always begins a NEW game with the current players.
  function handleStartGame() {
    const game = NOW.game;
    if (game.getPlayers().length < NOW.config.MIN_PLAYERS) {
      showToast(t('setup.toast.min', { min: NOW.config.MIN_PLAYERS }));
      renderPlayers();
      return;
    }

    const begin = function () {
      const res = game.startGame();
      if (!res.ok) {
        showToast(res.message);
        return;
      }
      ui.cardShown = false;
      NOW.cards.resetCard();
      showScreen('game');
    };

    if (game.hasProgress()) {
      confirmAction({
        title: t('setup.confirm.title'),
        message: t('setup.confirm.msg'),
        okLabel: t('setup.confirm.ok')
      }).then(function (ok) { if (ok) begin(); });
    } else {
      begin();
    }
  }

  // Part 1 continues in part 2 (game screen), then part 3.

  /* ==========================================================================
     PART 2 — Game screen, draw / complete flow, history dialog
     ========================================================================== */

  // Called by showScreen('game'): draws the whole screen and, after a
  // refresh or a resume, shows the card that was drawn but not finished.
  function onEnterGame() {
    renderGame();
    restoreCardView();
  }

  // Redraws everything on the game screen from NOW.game (the source of truth).
  function renderGame() {
    renderTurn();
    renderChips();
    updateWarning();
    updateControls();
    updateCardAccess();
  }

  /* ---------- Turn header, dots, counters ---------- */

  function renderTurn() {
    const info = NOW.game.getTurnInfo();
    const playerId = info.player ? info.player.id : '';

    el.currentPlayerName.textContent = info.player ? info.player.name : '\u2014';
    if (ui.shownPlayerId && playerId !== ui.shownPlayerId && !prefersReducedMotion()) {
      el.currentPlayerName.classList.remove('is-changing');
      void el.currentPlayerName.offsetWidth; // restart the animation
      el.currentPlayerName.classList.add('is-changing');
      global.clearTimeout(ui.nameTimer);
      ui.nameTimer = global.setTimeout(function () {
        el.currentPlayerName.classList.remove('is-changing');
      }, NAME_CHANGE_MS);
    }
    ui.shownPlayerId = playerId;

    el.turnIndicator.textContent = info.label;
    el.cardsDrawn.textContent = String(NOW.game.getCardsDrawn());

    clearChildren(el.turnDots);
    info.dots.forEach(function (dot) {
      const li = make('li', { className: 'turn-dot', attrs: { title: dot.name } });
      if (dot.state === 'current') li.classList.add('is-current');
      if (dot.state === 'done') li.classList.add('is-done');
      el.turnDots.appendChild(li);
    });
  }

  /* ---------- Category chips ---------- */

  // Random mode: read-only chips. Manual mode: buttons that pick the category.
  // Chips are shown for every enabled category; one without active
  // questions is dimmed (.is-empty) and cannot be picked.
  function renderChips() {
    const settings = NOW.game.getSettings();
    const manual = settings.categoryMode === 'manual';
    const disabled = new Set(settings.disabledCategories);

    el.modeLabel.textContent = t(manual ? 'game.mode.manual' : 'game.mode.random');
    // Random mode: nothing to pick, so hide the whole block. Manual mode needs it.
    el.categoryChips.parentElement.style.display = manual ? '' : 'none';
    clearChildren(el.categoryChips);

    NOW.questions.getCategories().forEach(function (category) {
      if (disabled.has(category.id)) return;
      const count = NOW.questions.getAll(category.id).length;
      const empty = count === 0;

      const chip = manual
        ? make('button', { className: 'chip', attrs: { type: 'button' } })
        : make('span', { className: 'chip' });
      applyCategoryTheme(chip, category);
      chip.appendChild(make('span', { className: 'chip__dot' }));
      chip.appendChild(doc.createTextNode(category.name));

      if (empty) chip.classList.add('is-empty');
      if (manual) {
        const selected = settings.manualCategory === category.id;
        chip.disabled = empty;
        chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
        if (selected) chip.classList.add('is-selected');
      }

      const li = make('li');
      li.appendChild(chip);
      el.categoryChips.appendChild(li);
    });
  }

  function handleChipClick(event) {
    const chip = event.target.closest('button.chip');
    if (!chip || !el.categoryChips.contains(chip) || chip.disabled) return;
    const id = chip.dataset.cat;
    if (!id) return;

    NOW.game.updateSettings({ categoryMode: 'manual', manualCategory: id });
    renderChips();
    updateWarning();
    updateCardAccess();
  }

  /* ---------- Warning banner ---------- */

  // Shows the message from game.js when no card can be drawn because of the
  // category setup. Never throws, never blocks the rest of the screen.
  function updateWarning() {
    const check = NOW.game.canDraw();
    const relevant = !check.ok && (
      check.reason === 'no-categories' ||
      check.reason === 'no-category-selected' ||
      check.reason === 'category-unavailable'
    );

    el.gameWarning.hidden = !relevant;
    if (!relevant) return;
    el.gameWarningText.textContent = check.message;
    // Choosing a chip fixes "no category selected"; settings fix the rest.
    el.btnWarningSettings.hidden = check.reason === 'no-category-selected';
  }

  /* ---------- Buttons and card accessibility ---------- */

  function isBusyNow() {
    return ui.locked || NOW.cards.isBusy();
  }

  // Draw / Done / Skip / Next are disabled while a card animates.
  function updateControls() {
    const busy = isBusyNow();
    const active = NOW.game.getCurrentCard() !== null;

    el.btnDraw.hidden = active;
    el.btnDraw.disabled = busy;
    el.cardActions.hidden = !(active && ui.cardShown);
    [el.btnDone, el.btnSkip, el.btnNext].forEach(function (btn) { btn.disabled = busy; });

    // The card may be animating because of something other than our own
    // flow: look again shortly so the buttons never stay disabled.
    if (busy && !ui.locked) {
      global.setTimeout(updateControls, 150);
    }
  }

  // #card acts as a button while it can be tapped to draw.
  function updateCardAccess() {
    const check = NOW.game.canDraw();
    const active = NOW.game.getCurrentCard() !== null;
    const busy = isBusyNow();

    el.card.setAttribute('aria-disabled', active || busy ? 'true' : 'false');
    el.card.setAttribute('aria-label', t(active ? 'card.aria.current' : 'card.aria.draw'));

    let hint = t('card.hint.tap');
    if (!check.ok && check.reason === 'no-category-selected') hint = t('card.hint.pick');
    else if (!check.ok && check.reason === 'no-categories') hint = t('card.hint.none');
    else if (!check.ok && check.reason === 'category-unavailable') hint = t('card.hint.another');
    el.cardBackHint.textContent = hint;
  }

  // One-time setup: role, focusability and handlers for the card and buttons.
  function bindGameEvents() {
    el.card.setAttribute('tabindex', '0');
    el.card.setAttribute('role', 'button');

    el.card.addEventListener('click', handleCardActivate);
    el.card.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault(); // Space must not scroll the page
      if (event.repeat) return;
      handleCardActivate();
    });

    el.btnDraw.addEventListener('click', function () { handleDraw(); });
    el.btnDone.addEventListener('click', function () { handleComplete('done'); });
    el.btnSkip.addEventListener('click', function () { handleComplete('skipped'); });
    el.btnNext.addEventListener('click', function () { handleComplete('passed'); });
    el.categoryChips.addEventListener('click', handleChipClick);

    el.btnHistory.addEventListener('click', openHistory);
    // Tap on the dimmed area closes the history sheet.
    el.historyDialog.addEventListener('click', function (event) {
      if (event.target === el.historyDialog) closeDialog(el.historyDialog);
    });
  }

  /* ---------- Draw / reveal ---------- */

  function toCardData(card) {
    return {
      category: card.category,
      text: card.text,
      description: card.description,
      difficulty: card.difficulty,
      number: card.number
    };
  }

  // Tap or Enter/Space on the card: draws, or re-shows a pending card.
  function handleCardActivate() {
    if (ui.cardShown) return; // already revealed: nothing to draw
    handleDraw();
  }

  // Draws the next card for the current player and flips it.
  // If a card is already pending but not visible, it is shown again.
  async function handleDraw() {
    if (ui.locked || NOW.cards.isBusy()) return;
    if (NOW.game.getCurrentCard()) {
      await showPendingCard();
      return;
    }

    ui.locked = true;
    updateControls();
    updateCardAccess();
    try {
      const res = NOW.game.drawCard();
      if (!res.ok) {
        renderGame();
        showToast(res.message, 3200);
        return;
      }

      ui.cardShown = false;
      renderGame(); // cards-drawn counter, hides the Draw button
      await revealCard(res.card);
    } catch (err) {
      reportError(t('err.draw'), err);
    } finally {
      ui.locked = false;
      updateControls();
      updateCardAccess();
    }
  }

  // Flips a card and shows the action buttons. One retry, then a hint.
  async function revealCard(card) {
    let shown = await NOW.cards.showCard(toCardData(card));
    if (!shown) {
      await NOW.cards.resetCard();
      shown = await NOW.cards.showCard(toCardData(card));
    }
    ui.cardShown = shown === true;
    if (!ui.cardShown) {
      showToast(t('toast.card_not_open'), 3200);
      return;
    }
    updateControls();
    if (ui.screen === 'game') focusElement(el.btnDone);
  }

  // Shows the card that game.js still holds (after refresh / resume).
  async function showPendingCard() {
    const card = NOW.game.getCurrentCard();
    if (!card || ui.locked) return;

    ui.locked = true;
    updateControls();
    try {
      await revealCard(card);
    } catch (err) {
      reportError(t('err.show'), err);
    } finally {
      ui.locked = false;
      updateControls();
      updateCardAccess();
    }
  }

  // After entering the game screen: sync the card with the game state.
  function restoreCardView() {
    const card = NOW.game.getCurrentCard();
    const state = NOW.cards.getState();

    if (card) {
      if (state === 'revealed') {
        ui.cardShown = true;
        updateControls();
      } else if (!NOW.cards.isBusy()) {
        ui.cardShown = false;
        showPendingCard();
      }
      return;
    }

    ui.cardShown = false;
    if (state !== 'idle') {
      NOW.cards.resetCard().then(function () {
        updateControls();
        updateCardAccess();
      });
    }
  }

  function focusElement(node) {
    if (!node || node.hidden || node.disabled) return;
    try { node.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }

  /* ---------- Finish the turn ---------- */

  // result: 'done' | 'skipped' | 'passed'. Records the card, flips it back
  // and moves on to the next player.
  async function handleComplete(result) {
    if (ui.locked || NOW.cards.isBusy()) return;

    if (!NOW.game.getCurrentCard()) {
      // Nothing to finish (e.g. state changed elsewhere): just resync.
      ui.cardShown = false;
      await NOW.cards.resetCard();
      renderGame();
      return;
    }
    if (!ui.cardShown) return; // card still flipping or not shown yet

    ui.locked = true;
    try {
      const res = NOW.game.completeCurrent(result);
      ui.cardShown = false;
      updateControls();
      if (!res.ok) showToast(res.message, 3200);

      await NOW.cards.resetCard(); // flip back before the next player appears
      renderGame();
      if (res.ok && res.roundChanged) showToast(t('toast.round', { n: res.round }));
    } catch (err) {
      reportError(t('err.complete'), err);
      renderGame();
    } finally {
      ui.locked = false;
      updateControls();
      updateCardAccess();
      if (ui.screen === 'game') focusElement(el.btnDraw);
    }
  }

  // Used by Settings > Reset game (after its confirm dialog).
  async function resetGameView() {
    NOW.game.resetGame();
    ui.cardShown = false;
    ui.shownPlayerId = '';
    try {
      await NOW.cards.resetCard();
    } catch (err) {
      /* the card is hidden anyway */
    }
    renderGame();
  }

  /* ---------- History dialog ---------- */

  // Newest entry first. Entries are plain data, written with textContent.
  function renderHistory() {
    const entries = NOW.game.getHistory().slice().reverse();

    clearChildren(el.historyList);
    entries.forEach(function (entry) {
      const category = NOW.questions.getCategory(entry.category);
      const item = make('li', {
        className: 'history-item',
        dataset: { result: entry.result }
      });
      applyCategoryTheme(item, category);

      item.appendChild(make('span', { className: 'history-item__num', text: '#' + entry.number }));

      const body = make('div');
      body.appendChild(make('div', { className: 'history-item__text', text: entry.text }));

      const meta = make('div', { className: 'history-item__meta' });
      meta.appendChild(make('span', {
        className: 'history-item__cat',
        text: category.unknown ? (entry.categoryName || category.name) : category.name
      }));
      meta.appendChild(make('span', { text: entry.playerName }));
      meta.appendChild(make('span', { text: resultLabel(entry.result) }));
      body.appendChild(meta);

      item.appendChild(body);
      el.historyList.appendChild(item);
    });

    el.historyEmpty.hidden = entries.length > 0;
    el.historyList.hidden = entries.length === 0;
  }

  function openHistory() {
    try {
      renderHistory();
    } catch (err) {
      reportError(t('err.history'), err);
      return;
    }
    openDialog(el.historyDialog);
  }

  // Part 2 continues in part 3 (creator, settings, events, startup).

  /* ==========================================================================
     PART 3 — Creator, settings, event binding, startup
     ========================================================================== */

  /* ---------- Creator: helpers ---------- */

  function readCustomQuestions() {
    return NOW.storage.loadCustomQuestions();
  }

  // Saves the custom list and tells the game about it. Returns true when
  // the data reached localStorage (false = memory only, a toast warns).
  function persistCustomQuestions(list) {
    const persisted = NOW.storage.saveCustomQuestions(list);
    try {
      NOW.game.rebuildQueues();
    } catch (err) {
      reportError(t('err.refresh_saved'), err);
    }
    if (!persisted) warnNotPersisted();
    return persisted;
  }

  // Adds an <option> when the select does not have the value (edit of a
  // question whose category no longer exists).
  function ensureOption(select, value, label) {
    const exists = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (!exists) select.appendChild(make('option', { text: label, attrs: { value: value } }));
  }

  // Fills the category <select> of the form and the list filter.
  function fillCategorySelects() {
    const categories = NOW.questions.getCategories();
    const formValue = el.questionCategory.value;
    const filterValue = el.filterCategory.value;

    clearChildren(el.questionCategory);
    categories.forEach(function (category) {
      el.questionCategory.appendChild(make('option', { text: category.name, attrs: { value: category.id } }));
    });
    if (formValue) ensureOption(el.questionCategory, formValue, NOW.questions.categoryName(formValue));
    el.questionCategory.value = formValue || (categories[0] ? categories[0].id : '');

    // Keep the static "all" option, rebuild the rest.
    while (el.filterCategory.options.length > 1) el.filterCategory.remove(1);
    categories.forEach(function (category) {
      el.filterCategory.appendChild(make('option', { text: category.name, attrs: { value: category.id } }));
    });
    el.filterCategory.value = filterValue || 'all';
    if (!el.filterCategory.value) el.filterCategory.value = 'all';
  }

  function updateQuestionCounter() {
    const max = NOW.config.TEXT_MAX;
    el.questionTextCount.textContent = Array.from(el.questionText.value).length + ' / ' + max;
  }

  function normalizeForCompare(text) {
    return NOW.storage.cleanText(text, 0).toLowerCase();
  }

  // True when the same text already exists in that category (custom or built-in).
  function isDuplicateQuestion(text, category, ignoreId) {
    const key = normalizeForCompare(text);
    const inBuiltIn = NOW.questions.getBuiltIn(category).some(function (q) {
      return normalizeForCompare(q.text) === key;
    });
    if (inBuiltIn) return 'built-in';
    const inCustom = readCustomQuestions().some(function (q) {
      return q.id !== ignoreId && q.category === category && normalizeForCompare(q.text) === key;
    });
    return inCustom ? 'custom' : '';
  }

  /* ---------- Creator: form and edit mode ---------- */

  // Form title and submit button follow the mode (new / edit) and the language.
  function refreshFormLabels() {
    const editing = !!ui.editingId;
    el.formTitle.textContent = t(editing ? 'creator.edit' : 'creator.new');
    el.btnSaveQuestion.textContent = t(editing ? 'creator.save' : 'creator.add');
  }

  // question = custom question object to edit, or null for "new question".
  function setEditMode(question) {
    const editing = !!question;
    ui.editingId = editing ? question.id : '';
    el.questionId.value = ui.editingId;
    refreshFormLabels();
    el.btnCancelEdit.hidden = !editing;
    clearFieldError(el.questionError, [el.questionText, el.questionCategory]);

    if (editing) {
      el.questionText.value = question.text;
      ensureOption(el.questionCategory, question.category, NOW.questions.categoryName(question.category));
      el.questionCategory.value = question.category;
      el.questionDifficulty.value = question.difficulty || '';
      el.questionDescription.value = question.description || '';
      updateQuestionCounter();
      el.questionForm.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      focusElement(el.questionText);
    } else {
      el.questionText.value = '';
      el.questionDescription.value = '';
      updateQuestionCounter();
    }
    renderCustomList(); // highlights nothing, but keeps the list in sync
  }

  function handleQuestionSubmit(event) {
    event.preventDefault();
    clearFieldError(el.questionError, [el.questionText, el.questionCategory]);

    const cfg = NOW.config;
    const text = NOW.storage.cleanText(el.questionText.value, cfg.TEXT_MAX);
    const category = el.questionCategory.value;
    const difficulty = cfg.DIFFICULTIES.indexOf(el.questionDifficulty.value) !== -1 ? el.questionDifficulty.value : '';
    const description = NOW.storage.cleanText(el.questionDescription.value, cfg.DESC_MAX);

    if (!text) {
      showFieldError(el.questionError, t('creator.err.empty'), el.questionText);
      el.questionText.focus();
      return;
    }
    if (Array.from(text).length < MIN_QUESTION_CHARS) {
      showFieldError(el.questionError, t('creator.err.short', { min: MIN_QUESTION_CHARS }), el.questionText);
      el.questionText.focus();
      return;
    }
    if (!category || !NOW.questions.hasCategory(category)) {
      showFieldError(el.questionError, t('creator.err.cat'), el.questionCategory);
      el.questionCategory.focus();
      return;
    }
    const duplicate = isDuplicateQuestion(text, category, ui.editingId);
    if (duplicate) {
      const where = NOW.questions.categoryName(category);
      showFieldError(el.questionError, duplicate === 'built-in'
        ? t('creator.err.dup_builtin', { where: where })
        : t('creator.err.dup_custom', { where: where }), el.questionText);
      el.questionText.focus();
      return;
    }

    const list = readCustomQuestions();
    const index = ui.editingId ? list.findIndex(function (q) { return q.id === ui.editingId; }) : -1;
    let message;
    if (index !== -1) {
      list[index] = Object.assign({}, list[index], {
        text: text, category: category, difficulty: difficulty, description: description
      });
      message = t('creator.toast.updated');
    } else {
      list.push({
        id: NOW.storage.uid('q'),
        category: category,
        text: text,
        description: description,
        difficulty: difficulty,
        enabled: true,
        custom: true,
        createdAt: Date.now()
      });
      message = t(ui.editingId ? 'creator.toast.readded' : 'creator.toast.added');
    }

    persistCustomQuestions(list);

    // Keep category and difficulty for quick bulk entry; clear the texts.
    const wasEditing = !!ui.editingId;
    ui.editingId = '';
    setEditMode(null);
    if (wasEditing) el.questionCategory.value = category;
    if (el.filterCategory.value !== 'all' && el.filterCategory.value !== category) {
      el.filterCategory.value = 'all'; // make sure the new question is visible
    }
    renderCustomList();
    showToast(message);
    focusElement(el.questionText);
  }

  /* ---------- Creator: list of custom questions ---------- */

  function renderCreator() {
    fillCategorySelects();
    updateQuestionCounter();
    renderCustomList();
  }

  function renderCustomList() {
    const filter = el.filterCategory.value;
    const all = readCustomQuestions();
    const list = all
      .filter(function (q) { return !filter || filter === 'all' || q.category === filter; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });

    clearChildren(el.customList);
    list.forEach(function (question) { el.customList.appendChild(buildQuestionItem(question)); });

    el.customCount.textContent = String(list.length);
    el.customEmpty.hidden = list.length > 0;
    el.customEmpty.textContent = all.length && !list.length
      ? t('creator.empty_cat')
      : t('creator.empty');
  }

  function buildQuestionItem(question) {
    const category = NOW.questions.getCategory(question.category);
    const li = make('li', { className: 'q-item', dataset: { id: question.id } });
    applyCategoryTheme(li, category);
    if (question.enabled === false) li.classList.add('is-disabled');
    if (question.id === ui.editingId) li.setAttribute('aria-current', 'true');

    li.appendChild(make('div', { className: 'q-item__text', text: question.text }));

    const meta = make('div', { className: 'q-item__meta' });
    meta.appendChild(make('span', { className: 'q-item__cat', text: category.name }));
    if (question.difficulty) meta.appendChild(make('span', { text: question.difficulty }));
    li.appendChild(meta);

    if (question.description) {
      li.appendChild(make('div', { className: 'q-item__desc', text: question.description }));
    }

    const actions = make('div', { className: 'q-item__actions' });
    const toggle = make('label', { className: 'q-item__toggle' });
    const input = make('input', {
      className: 'switch switch--sm',
      attrs: { type: 'checkbox', role: 'switch' }
    });
    input.checked = question.enabled !== false;
    toggle.appendChild(input);
    toggle.appendChild(make('span', { text: t('creator.in_game') }));
    actions.appendChild(toggle);
    actions.appendChild(makeIconButton('edit', t('creator.edit_btn'), ''));
    actions.appendChild(makeIconButton('trash', t('creator.delete_btn'), 'icon-btn--danger'));
    li.appendChild(actions);
    return li;
  }

  function findCustomQuestion(id) {
    return readCustomQuestions().filter(function (q) { return q.id === id; })[0] || null;
  }

  function handleCustomListClick(event) {
    const button = event.target.closest('button');
    if (!button || !el.customList.contains(button)) return;
    const item = button.closest('.q-item');
    const id = item ? item.dataset.id : '';
    const question = id ? findCustomQuestion(id) : null;
    if (!question) {
      renderCustomList();
      return;
    }

    if (button.querySelector('use[href="#icon-edit"]')) {
      setEditMode(question);
    } else if (button.querySelector('use[href="#icon-trash"]')) {
      confirmAction({
        title: t('creator.del.title'),
        message: t('creator.del.msg', { text: question.text }),
        okLabel: t('creator.del.ok')
      }).then(function (ok) {
        if (!ok) return;
        const rest = readCustomQuestions().filter(function (q) { return q.id !== id; });
        persistCustomQuestions(rest);
        if (ui.editingId === id) setEditMode(null);
        renderCustomList();
        showToast(t('creator.toast.deleted'));
      });
    }
  }

  // The "In game" switch enables or disables a question without deleting it.
  function handleCustomListChange(event) {
    const input = event.target;
    if (!input || input.type !== 'checkbox') return;
    const item = input.closest('.q-item');
    const id = item ? item.dataset.id : '';
    if (!id) return;

    const list = readCustomQuestions();
    const question = list.filter(function (q) { return q.id === id; })[0];
    if (!question) {
      renderCustomList();
      return;
    }
    question.enabled = input.checked;
    persistCustomQuestions(list);
    item.classList.toggle('is-disabled', !input.checked);
  }

  /* ---------- Settings ---------- */

  function renderSettings() {
    const settings = NOW.game.getSettings();
    const disabled = new Set(settings.disabledCategories);

    clearChildren(el.settingsCategories);
    NOW.questions.getCategories().forEach(function (category) {
      const count = NOW.questions.getAll(category.id).length;
      const li = make('li', { className: 'toggle-item' });
      applyCategoryTheme(li, category);
      li.appendChild(make('span', { className: 'toggle-item__dot' }));

      const text = make('div', { className: 'toggle-item__text' });
      text.appendChild(make('strong', { text: category.name }));
      text.appendChild(make('small', {
        text: plural(count, 'card') + (category.description ? ' \u00B7 ' + category.description : '')
      }));
      li.appendChild(text);

      const input = make('input', {
        className: 'switch',
        attrs: { type: 'checkbox', role: 'switch', 'aria-label': t('settings.enable', { name: category.name }) },
        dataset: { id: category.id }
      });
      input.checked = !disabled.has(category.id);
      li.appendChild(input);
      el.settingsCategories.appendChild(li);
    });

    el.modeRandom.checked = settings.categoryMode !== 'manual';
    el.modeManual.checked = settings.categoryMode === 'manual';
    el.settingRepeat.checked = settings.allowRepeat === true;

    Array.prototype.forEach.call(doc.querySelectorAll('input[name="language"]'), function (radio) {
      radio.checked = radio.value === NOW.i18n.getLang();
    });
  }

  function handleCategoryToggle(event) {
    const input = event.target;
    if (!input || input.type !== 'checkbox' || !input.dataset.id) return;

    const disabledIds = [];
    Array.prototype.forEach.call(el.settingsCategories.querySelectorAll('input[type="checkbox"]'), function (box) {
      if (!box.checked && box.dataset.id) disabledIds.push(box.dataset.id);
    });
    NOW.game.updateSettings({ disabledCategories: disabledIds });

    const total = NOW.questions.getCategories().length;
    if (disabledIds.length >= total) {
      showToast(t('toast.all_off'), 3500);
    }
  }

  // Tapping anywhere on a row toggles it (bigger touch target).
  function handleCategoryRowClick(event) {
    if (event.target.closest('input')) return;
    const row = event.target.closest('.toggle-item');
    const input = row ? row.querySelector('input[type="checkbox"]') : null;
    if (input) input.click();
  }

  function handleModeChange() {
    const manual = el.modeManual.checked;
    const patch = { categoryMode: manual ? 'manual' : 'random' };
    if (manual) {
      // Never leave manual mode without a valid selection if one is possible.
      const current = NOW.game.getSettings().manualCategory;
      const usable = NOW.game.getUsableCategories();
      const valid = usable.some(function (c) { return c.id === current; });
      if (!valid && usable.length) patch.manualCategory = usable[0].id;
    }
    NOW.game.updateSettings(patch);
    showToast(t(manual ? 'toast.manual' : 'toast.random'));
  }

  function handleRepeatChange() {
    NOW.game.updateSettings({ allowRepeat: el.settingRepeat.checked });
  }

  function handleResetGame() {
    confirmAction({
      title: t('reset.game.title'),
      message: t('reset.game.msg'),
      okLabel: t('reset.game.ok')
    }).then(function (ok) {
      if (!ok) return;
      return resetGameView().then(function () { showToast(t('reset.game.done')); });
    });
  }

  function handleResetCustom() {
    confirmAction({
      title: t('reset.custom.title'),
      message: t('reset.custom.msg'),
      okLabel: t('reset.custom.ok')
    }).then(function (ok) {
      if (!ok) return;
      NOW.storage.resetCustomQuestions();
      try { NOW.game.rebuildQueues(); } catch (err) { reportError(t('err.refresh'), err); }
      if (ui.editingId) setEditMode(null);
      renderCustomList();
      renderSettings();
      showToast(t('reset.custom.done'));
    });
  }

  /* ---------- Startup: elements, events, boot ---------- */

  // Looks up every element once. A missing id is a clear error, not a freeze.
  function cacheElements() {
    function need(id) {
      const node = byId(id);
      if (!node) throw new Error('Missing element #' + id);
      return node;
    }

    el.screens = Array.prototype.slice.call(doc.querySelectorAll('.screen[data-screen]'));
    el.toast = need('toast');
    el.confirmDialog = need('confirm-dialog');
    el.confirmTitle = need('confirm-title');
    el.confirmMessage = need('confirm-message');
    el.confirmOk = need('confirm-ok');
    el.confirmCancel = need('confirm-cancel');

    el.playerForm = need('player-form');
    el.playerInput = need('player-name-input');
    el.btnAddPlayer = need('btn-add-player');
    el.playerError = need('player-error');
    el.playerCount = need('player-count');
    el.playerList = need('player-list');
    el.playerEmpty = need('player-empty');
    el.setupHint = need('setup-hint');
    el.btnStartGame = need('btn-start-game');

    el.currentPlayerName = need('current-player-name');
    el.btnHistory = need('btn-history');
    el.turnIndicator = need('turn-indicator');
    el.turnDots = need('turn-dots');
    el.cardsDrawn = need('cards-drawn');
    el.gameWarning = need('game-warning');
    el.gameWarningText = need('game-warning-text');
    el.btnWarningSettings = need('btn-warning-settings');
    el.card = need('card');
    el.cardBackHint = need('card-back-hint');
    el.modeLabel = need('mode-label');
    el.categoryChips = need('category-chips');
    el.btnDraw = need('btn-draw');
    el.cardActions = need('card-actions');
    el.btnDone = need('btn-done');
    el.btnSkip = need('btn-skip');
    el.btnNext = need('btn-next');

    el.questionForm = need('question-form');
    el.formTitle = need('form-title');
    el.questionId = need('question-id');
    el.questionText = need('question-text');
    el.questionTextCount = need('question-text-count');
    el.questionCategory = need('question-category');
    el.questionDifficulty = need('question-difficulty');
    el.questionDescription = need('question-description');
    el.questionError = need('question-error');
    el.btnSaveQuestion = need('btn-save-question');
    el.btnCancelEdit = need('btn-cancel-edit');
    el.customCount = need('custom-count');
    el.filterCategory = need('filter-category');
    el.customList = need('custom-list');
    el.customEmpty = need('custom-empty');

    el.settingsCategories = need('settings-categories');
    el.modeRandom = need('mode-random');
    el.modeManual = need('mode-manual');
    el.settingRepeat = need('setting-repeat');
    el.btnResetGame = need('btn-reset-game');
    el.btnResetCustom = need('btn-reset-custom');

    el.historyDialog = need('history-dialog');
    el.historyList = need('history-list');
    el.historyEmpty = need('history-empty');
  }

  // Runs one group of bindings so a failure cannot break the others.
  function safely(label, fn) {
    try {
      fn();
    } catch (err) {
      reportError(t('err.part', { label: label }), err);
    }
  }

  // Language radios in Settings: switching re-translates the whole app.
  function bindLanguage() {
    Array.prototype.forEach.call(doc.querySelectorAll('input[name="language"]'), function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) NOW.i18n.setLang(radio.value);
      });
    });
    NOW.i18n.onChange(refreshLanguage);
  }

  // Redraws every part that is built by JavaScript (static HTML is handled by i18n.apply()).
  function refreshLanguage() {
    safely('language', function () {
      renderPlayers();
      renderGame();
      renderCreator();
      refreshFormLabels();
      renderSettings();
      if (el.historyDialog.open) renderHistory();
    });
  }

  function bindEvents() {
    // Navigation: every element with data-goto.
    doc.addEventListener('click', function (event) {
      const trigger = event.target.closest('[data-goto]');
      if (!trigger || trigger.disabled) return;
      navigate(trigger.getAttribute('data-goto'), trigger);
    });

    safely('setup', function () {
      el.playerForm.addEventListener('submit', handlePlayerSubmit);
      el.playerInput.addEventListener('input', function () {
        clearFieldError(el.playerError, [el.playerInput]);
      });
      el.playerList.addEventListener('click', handlePlayerListClick);
      el.btnStartGame.addEventListener('click', handleStartGame);
    });

    safely('game', bindGameEvents);

    safely('creator', function () {
      el.questionForm.addEventListener('submit', handleQuestionSubmit);
      el.questionText.addEventListener('input', function () {
        updateQuestionCounter();
        clearFieldError(el.questionError, [el.questionText, el.questionCategory]);
      });
      el.questionCategory.addEventListener('change', function () {
        clearFieldError(el.questionError, [el.questionText, el.questionCategory]);
      });
      el.btnCancelEdit.addEventListener('click', function () { setEditMode(null); });
      el.filterCategory.addEventListener('change', renderCustomList);
      el.customList.addEventListener('click', handleCustomListClick);
      el.customList.addEventListener('change', handleCustomListChange);
    });

    safely('settings', function () {
      el.settingsCategories.addEventListener('change', handleCategoryToggle);
      el.settingsCategories.addEventListener('click', handleCategoryRowClick);
      el.modeRandom.addEventListener('change', handleModeChange);
      el.modeManual.addEventListener('change', handleModeChange);
      el.settingRepeat.addEventListener('change', handleRepeatChange);
      el.btnResetGame.addEventListener('click', handleResetGame);
      el.btnResetCustom.addEventListener('click', handleResetCustom);
    });

    // Safety net: an unexpected error must never leave the buttons locked.
    global.addEventListener('unhandledrejection', releaseLock);
    global.addEventListener('error', releaseLock);
  }

  function releaseLock() {
    ui.locked = false;
    try { updateControls(); } catch (err) { /* ignore */ }
  }

  // Last resort when the app cannot start at all (missing script or markup).
  function showFatal(message) {
    const box = doc.createElement('p');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'margin:16px;padding:14px;border-radius:12px;background:#2a1215;color:#fff;font:600 14px/1.4 system-ui,sans-serif';
    box.textContent = message;
    doc.body.insertBefore(box, doc.body.firstChild);
  }

  function checkDependencies() {
    const parts = ['config', 'storage', 'i18n', 'questions', 'cards', 'game'];
    const missing = parts.filter(function (name) { return !NOW[name]; });
    if (missing.length) throw new Error('Missing scripts: ' + missing.join(', '));
  }

  function boot() {
    if (ui.started) return;
    ui.started = true;

    try {
      checkDependencies();
      cacheElements();
    } catch (err) {
      try { console.error('[NOW OR NEVER] startup failed', err); } catch (e) { /* ignore */ }
      showFatal('NOW OR NEVER could not start. Reload the page. (' + (err && err.message ? err.message : 'unknown error') + ')');
      return;
    }

    bindEvents();
    safely('language', function () {
      NOW.i18n.apply();
      bindLanguage();
    });

    try {
      NOW.game.init();
    } catch (err) {
      reportError(t('err.saved_data'), err);
    }

    // Make sure exactly one screen is active (home by default).
    const active = el.screens.filter(function (s) { return s.classList.contains('is-active'); })[0];
    ui.screen = active ? active.dataset.screen : 'home';
    if (!active) {
      const home = byId('screen-home');
      if (home) home.classList.add('is-active');
      ui.screen = 'home';
    }

    safely('render', function () {
      renderPlayers();
      updateQuestionCounter();
    });

    if (!NOW.storage.isPersistent()) {
      showToast(t('toast.storage_boot'), 5000);
    }
  }

  // Scripts are deferred, so the DOM is normally ready; the listener covers
  // the rare case where this file runs earlier.
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Small public surface (handy for debugging in the console).
  NOW.app = Object.freeze({
    showScreen: showScreen,
    showToast: showToast,
    confirmAction: confirmAction
  });
})(window);
