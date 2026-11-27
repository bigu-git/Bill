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
  const SCREENS = ['home', 'setup', 'game', 'creator', 'library', 'settings', 'howto'];
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
    libFilter: 'all',       // category id shown in All cards ('all' = every category)
    libQuery: '',           // search text in All cards
    libLevel: 'all',        // difficulty filter in All cards ('all' | easy | medium | hard)
    libFav: false,          // true = only saved cards
    libTrash: false,        // true = showing the deleted built-in cards
    libEditId: '',          // card open in the edit dialog
    favorites: null,        // Set of saved card ids (loaded lazily from storage)
    libView: [],            // cards currently shown: [{ q, number, category }]
    libIndex: 0,            // position of the open preview inside libView
    libOpenId: '',          // id of the card in the open preview
    libDirty: false,        // saved cards changed while the preview was open
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
      else if (name === 'library') renderLibrary(true);
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

  /* ---------- All cards (library) ---------- */
  // Mini-card grid, filters (category, difficulty, saved), search with
  // highlighting, and a full-size card preview with swipe / arrow navigation.
  // Saved cards are stored under the "favorites" key (list of card ids).

  const FAV_KEY = 'favorites';
  const FAV_MAX = 1000;
  const LEVELS = ['easy', 'medium', 'hard'];
  const LONG_TEXT = 90;     // same thresholds as js/cards.js
  const XLONG_TEXT = 140;
  const THEME_VARS = ['--cat', '--cat-ink', '--cat-accent', '--cat-edge'];

  function normalizeSearch(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Every card in the game (built-in + custom, enabled or not), as a flat list.
  function libraryCards() {
    return NOW.questions.getAllIncludingDisabled();
  }

  /* -- Saved cards -- */

  function favorites() {
    if (ui.favorites) return ui.favorites;
    let raw = [];
    try { raw = NOW.storage.get(FAV_KEY, []); } catch (err) { raw = []; }
    const set = new Set();
    if (Array.isArray(raw)) {
      raw.forEach(function (id) {
        if (typeof id === 'string' && id && set.size < FAV_MAX) set.add(id);
      });
    }
    ui.favorites = set;
    return set;
  }

  function saveFavorites() {
    try { NOW.storage.set(FAV_KEY, Array.from(favorites())); } catch (err) { /* memory only */ }
  }

  /* -- Small builders -- */

  function levelOf(difficulty) {
    return LEVELS.indexOf(difficulty) + 1; // 0 = no difficulty
  }

  // Three dots; the first `level` are filled.
  function makePips(level, label) {
    const wrap = make('span', {
      className: 'pips',
      attrs: label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
    });
    for (let i = 1; i <= 3; i++) {
      wrap.appendChild(make('span', { className: 'pips__dot' + (i <= level ? ' is-on' : '') }));
    }
    return wrap;
  }

  // Writes `text` into `node`, wrapping every match of `query` in <mark>.
  function setHighlighted(node, text, query) {
    const source = String(text || '');
    const lower = source.toLowerCase();
    let at = query && lower.length === source.length ? lower.indexOf(query) : -1;
    if (at === -1) {
      node.textContent = source;
      return;
    }
    let pos = 0;
    while (at !== -1) {
      if (at > pos) node.appendChild(doc.createTextNode(source.slice(pos, at)));
      node.appendChild(make('mark', { className: 'hl', text: source.slice(at, at + query.length) }));
      pos = at + query.length;
      at = lower.indexOf(query, pos);
    }
    if (pos < source.length) node.appendChild(doc.createTextNode(source.slice(pos)));
  }

  function buildLibraryTile(item, query, isFav, order) {
    const question = item.q;
    const li = make('li', { className: 'lib-item' });
    li.style.setProperty('--i', String(Math.min(order, 16)));

    const tile = make('button', {
      className: 'lib-card' + (question.custom && question.enabled === false ? ' is-disabled' : '') + (ui.libTrash ? ' is-removed' : ''),
      attrs: { type: 'button', 'aria-haspopup': 'dialog' },
      dataset: { id: question.id }
    });
    applyCategoryTheme(tile, item.category);

    const top = make('span', { className: 'lib-card__top' });
    top.appendChild(make('span', { text: '#' + item.number }));
    const star = make('span', { className: 'lib-card__fav' + (isFav ? ' is-on' : '') });
    star.appendChild(makeIcon('star'));
    star.appendChild(make('span', { className: 'sr-only', text: t('library.fav') }));
    top.appendChild(star);
    tile.appendChild(top);

    const text = make('span', { className: 'lib-card__text' });
    setHighlighted(text, question.text, query);
    tile.appendChild(text);

    const foot = make('span', { className: 'lib-card__foot' });
    if (question.difficulty) {
      foot.appendChild(makePips(levelOf(question.difficulty), t('diff.' + question.difficulty)));
    }
    if (question.custom) foot.appendChild(make('span', { className: 'lib-card__tag', text: t('library.custom') }));
    if (question.edited) foot.appendChild(make('span', { className: 'lib-card__tag', text: t('library.edited') }));
    if (question.custom && question.enabled === false) {
      foot.appendChild(make('span', { className: 'lib-card__tag lib-card__tag--off', text: t('library.off') }));
    }
    tile.appendChild(foot);

    li.appendChild(tile);
    return li;
  }

  function findTile(id) {
    const tiles = el.libraryGroups.querySelectorAll('.lib-card');
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].dataset.id === id) return tiles[i];
    }
    return null;
  }

  function libraryFiltersActive() {
    return !!(normalizeSearch(ui.libQuery) || ui.libFilter !== 'all' || ui.libLevel !== 'all' || ui.libFav || ui.libTrash);
  }

  /* -- Main render -- */

  // animate = true plays the staggered entrance (screen open, filter change).
  function renderLibrary(animate) {
    const categories = NOW.questions.getCategories();
    const live = libraryCards();
    const removedCards = NOW.questions.getRemoved();
    if (ui.libTrash && !removedCards.length) ui.libTrash = false;
    const all = ui.libTrash ? removedCards : live;
    const saved = favorites();
    const query = normalizeSearch(ui.libQuery);

    if (ui.libFilter !== 'all' && !categories.some(function (c) { return c.id === ui.libFilter; })) {
      ui.libFilter = 'all';
    }
    if (ui.libLevel !== 'all' && LEVELS.indexOf(ui.libLevel) === -1) ui.libLevel = 'all';

    // Forget saved cards that no longer exist (deleted custom cards).
    if (live.length) {
      const known = new Set(live.concat(removedCards).map(function (q) { return q.id; }));
      let pruned = false;
      saved.forEach(function (id) {
        if (!known.has(id)) { saved.delete(id); pruned = true; }
      });
      if (pruned) saveFavorites();
    }

    // Stable card numbers: position inside the category, whatever the filters.
    // Built-in cards keep their original number even after others are deleted;
    // custom cards are numbered after the last built-in card.
    const numbers = {};
    const builtMax = {};
    const customCount = {};
    const categoryNames = {};
    categories.forEach(function (c) { categoryNames[c.id] = c.name; });
    const builtNumber = function (q) { return parseInt(String(q.id).split('-').pop(), 10) || 0; };
    live.concat(removedCards).forEach(function (q) {
      if (q.custom) return;
      builtMax[q.category] = Math.max(builtMax[q.category] || 0, builtNumber(q));
    });
    live.concat(removedCards).forEach(function (q) {
      if (!q.custom) {
        numbers[q.id] = builtNumber(q);
      } else {
        customCount[q.category] = (customCount[q.category] || 0) + 1;
        numbers[q.id] = (builtMax[q.category] || 0) + customCount[q.category];
      }
    });

    const matchesText = function (q) {
      if (!query) return true;
      const haystack = q.text + ' ' + (q.description || '') + ' ' + (categoryNames[q.category] || '');
      return normalizeSearch(haystack).indexOf(query) !== -1;
    };
    const base = all.filter(function (q) {
      return matchesText(q) &&
        (ui.libLevel === 'all' || q.difficulty === ui.libLevel) &&
        (!ui.libFav || saved.has(q.id));
    });

    // Search box helpers.
    el.libraryClear.hidden = !ui.libQuery;

    // Category chips (counts follow every other filter).
    clearChildren(el.libraryChips);
    const chipData = [{ id: 'all', name: t('library.all'), category: null }].concat(
      categories.map(function (c) { return { id: c.id, name: c.name, category: c }; })
    );
    chipData.forEach(function (item) {
      const count = base.filter(function (q) { return item.id === 'all' || q.category === item.id; }).length;
      const chip = make('button', {
        className: 'chip' + (item.id === 'all' ? ' chip--all' : ''),
        attrs: { type: 'button', 'aria-pressed': ui.libFilter === item.id ? 'true' : 'false' },
        dataset: { filter: item.id }
      });
      if (item.category) {
        applyCategoryTheme(chip, item.category);
        chip.appendChild(make('span', { className: 'chip__dot' }));
      }
      chip.appendChild(doc.createTextNode(item.name + ' '));
      chip.appendChild(make('span', { className: 'chip__count', text: String(count) }));
      if (ui.libFilter === item.id) chip.classList.add('is-selected');
      el.libraryChips.appendChild(make('li', {})).appendChild(chip);
    });

    // Saved + difficulty chips.
    clearChildren(el.libraryFilters);
    const favChip = make('button', {
      className: 'chip chip--fav' + (ui.libFav ? ' is-selected' : ''),
      attrs: { type: 'button', 'aria-pressed': ui.libFav ? 'true' : 'false' },
      dataset: { fav: '1' }
    });
    favChip.appendChild(makeIcon('star'));
    favChip.appendChild(doc.createTextNode(t('library.fav') + ' '));
    favChip.appendChild(make('span', { className: 'chip__count', text: String(saved.size) }));
    el.libraryFilters.appendChild(make('li', {})).appendChild(favChip);
    if (removedCards.length) {
      const trashChip = make('button', {
        className: 'chip chip--trash' + (ui.libTrash ? ' is-selected' : ''),
        attrs: { type: 'button', 'aria-pressed': ui.libTrash ? 'true' : 'false' },
        dataset: { trash: '1' }
      });
      trashChip.appendChild(makeIcon('trash'));
      trashChip.appendChild(doc.createTextNode(t('library.trash') + ' '));
      trashChip.appendChild(make('span', { className: 'chip__count', text: String(removedCards.length) }));
      el.libraryFilters.appendChild(make('li', {})).appendChild(trashChip);
    }
    el.libraryFilters.appendChild(make('li', { className: 'lib-filters__sep', attrs: { 'aria-hidden': 'true' } }));
    ['all'].concat(LEVELS).forEach(function (level) {
      const chip = make('button', {
        className: 'chip' + (ui.libLevel === level ? ' is-selected' : ''),
        attrs: { type: 'button', 'aria-pressed': ui.libLevel === level ? 'true' : 'false' },
        dataset: { level: level }
      });
      if (level === 'all') {
        chip.appendChild(doc.createTextNode(t('library.any_level')));
      } else {
        chip.appendChild(makePips(levelOf(level), null));
        chip.appendChild(doc.createTextNode(t('diff.' + level)));
      }
      el.libraryFilters.appendChild(make('li', {})).appendChild(chip);
    });

    // Groups of mini cards.
    clearChildren(el.libraryGroups);
    el.libraryGroups.classList.toggle('is-entering', !!animate && !prefersReducedMotion());
    ui.libView = [];
    let shown = 0;
    categories.forEach(function (category) {
      if (ui.libFilter !== 'all' && ui.libFilter !== category.id) return;
      const cards = base.filter(function (q) { return q.category === category.id; });
      if (!cards.length) return;
      shown += cards.length;

      const group = make('section', { className: 'lib-group' });
      applyCategoryTheme(group, category);

      const head = make('div', { className: 'lib-group__head' });
      head.appendChild(make('span', { className: 'chip__dot' }));
      head.appendChild(make('h3', { className: 'lib-group__title', text: category.name }));
      head.appendChild(make('span', { className: 'badge', text: String(cards.length) }));
      group.appendChild(head);

      const grid = make('ul', { className: 'lib-grid' });
      cards.forEach(function (question) {
        const item = { q: question, number: numbers[question.id] || 0, category: category };
        ui.libView.push(item);
        grid.appendChild(buildLibraryTile(item, query, saved.has(question.id), ui.libView.length - 1));
      });
      group.appendChild(grid);
      el.libraryGroups.appendChild(group);
    });

    el.libraryCount.textContent = String(shown);
    el.libraryEmpty.hidden = shown > 0;
    if (shown === 0) {
      el.libraryEmptyText.textContent = ui.libFav && saved.size === 0 && !query && ui.libLevel === 'all'
        ? t('library.no_fav')
        : t('library.empty');
      el.libraryReset.hidden = !libraryFiltersActive();
    }

    if (el.libDialog.open) syncPreviewAfterRender();
  }

  /* -- Filter events -- */

  function handleLibraryChipClick(event) {
    const chip = event.target.closest('button[data-filter]');
    if (!chip) return;
    ui.libFilter = chip.dataset.filter;
    renderLibrary(true);
    try { global.scrollTo(0, 0); } catch (err) { /* ignore */ }
  }

  function handleLibraryFilterClick(event) {
    const chip = event.target.closest('button.chip');
    if (!chip) return;
    if (chip.dataset.fav) ui.libFav = !ui.libFav;
    else if (chip.dataset.trash) ui.libTrash = !ui.libTrash;
    else if (chip.dataset.level) ui.libLevel = chip.dataset.level;
    else return;
    renderLibrary(true);
  }

  function clearLibrarySearch() {
    ui.libQuery = '';
    el.librarySearch.value = '';
    renderLibrary(false);
    try { el.librarySearch.focus(); } catch (err) { /* ignore */ }
  }

  function resetLibraryFilters() {
    ui.libQuery = '';
    ui.libFilter = 'all';
    ui.libLevel = 'all';
    ui.libFav = false;
    ui.libTrash = false;
    el.librarySearch.value = '';
    renderLibrary(true);
  }

  /* -- Card preview -- */

  function resetPreviewTheme() {
    THEME_VARS.forEach(function (name) { el.libCard.style.removeProperty(name); });
  }

  // direction: null (opening) | 'next' | 'prev' | 'none' (no animation)
  function renderPreview(direction) {
    const item = ui.libView[ui.libIndex];
    if (!item) return;
    const question = item.q;
    ui.libOpenId = question.id;

    resetPreviewTheme();
    applyCategoryTheme(el.libCard, item.category);

    el.libCardCat.textContent = item.category.name;
    el.libCardNum.textContent = '#' + item.number;

    el.libCardText.textContent = question.text;
    const length = Array.from(question.text).length;
    el.libCardText.classList.toggle('is-long', length > LONG_TEXT);
    el.libCardText.classList.toggle('is-xlong', length > XLONG_TEXT);

    el.libCardNote.textContent = question.description || '';
    el.libCardNote.hidden = !question.description;

    el.libCardDiff.textContent = question.difficulty ? t('diff.' + question.difficulty) : '';
    el.libCardDiff.hidden = !question.difficulty;

    const total = ui.libView.length;
    el.libPos.textContent = (ui.libIndex + 1) + ' / ' + total;
    el.libPrev.disabled = total < 2;
    el.libNext.disabled = total < 2;
    syncPreviewFavorite(false);
    el.libEdit.hidden = ui.libTrash;
    el.libDelete.hidden = ui.libTrash;
    el.libRestore.hidden = !ui.libTrash;

    el.libCard.classList.remove('is-opening', 'is-next', 'is-prev');
    if (direction && direction !== 'none' && !prefersReducedMotion()) {
      void el.libCard.offsetWidth; // restart the animation
      el.libCard.classList.add(direction === 'next' ? 'is-next' : 'is-prev');
    } else if (!direction && !prefersReducedMotion()) {
      void el.libCard.offsetWidth;
      el.libCard.classList.add('is-opening');
    }
  }

  function syncPreviewFavorite(pop) {
    const item = ui.libView[ui.libIndex];
    const isFav = !!item && favorites().has(item.q.id);
    el.libFav.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    el.libFav.setAttribute('aria-label', t(isFav ? 'library.fav_remove' : 'library.fav_add'));
    el.libFav.classList.remove('is-pop');
    if (pop && !prefersReducedMotion()) {
      void el.libFav.offsetWidth;
      el.libFav.classList.add('is-pop');
    }
  }

  function openLibraryPreview(id) {
    let index = -1;
    for (let i = 0; i < ui.libView.length; i++) {
      if (ui.libView[i].q.id === id) { index = i; break; }
    }
    if (index < 0) return;
    ui.libIndex = index;
    ui.libDirty = false;
    renderPreview(null);
    openDialog(el.libDialog);
    try { el.libClose.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }

  function stepPreview(direction) {
    const total = ui.libView.length;
    if (total < 2) return;
    ui.libIndex = (ui.libIndex + direction + total) % total;
    renderPreview(direction > 0 ? 'next' : 'prev');
  }

  function toggleLibraryFavorite() {
    const item = ui.libView[ui.libIndex];
    if (!item) return;
    const saved = favorites();
    const id = item.q.id;
    if (saved.has(id)) {
      saved.delete(id);
    } else {
      if (saved.size >= FAV_MAX) return;
      saved.add(id);
    }
    saveFavorites();
    ui.libDirty = true;
    syncPreviewFavorite(true);

    // Update the tile behind the dialog in place (full redraw happens on close).
    const tile = findTile(id);
    if (tile) {
      const star = tile.querySelector('.lib-card__fav');
      if (star) star.classList.toggle('is-on', saved.has(id));
    }
  }

  // The grid was rebuilt while the preview is open (e.g. language switch).
  function syncPreviewAfterRender() {
    let index = -1;
    for (let i = 0; i < ui.libView.length; i++) {
      if (ui.libView[i].q.id === ui.libOpenId) { index = i; break; }
    }
    if (index < 0) {
      ui.libOpenId = '';
      closeDialog(el.libDialog);
      return;
    }
    ui.libIndex = index;
    renderPreview('none');
  }

  function handlePreviewClose() {
    const id = ui.libOpenId;
    if (ui.libDirty) {
      ui.libDirty = false;
      try { renderLibrary(false); } catch (err) { reportError(t('err.screen'), err); }
    }
    const tile = id ? findTile(id) : null;
    if (tile) {
      try {
        tile.scrollIntoView({ block: 'center' });
        tile.focus({ preventScroll: true });
      } catch (err) { /* ignore */ }
    }
  }

  function handleLibraryTileClick(event) {
    const tile = event.target.closest('.lib-card');
    if (tile) openLibraryPreview(tile.dataset.id);
  }

  /* -- Edit / delete / restore -- */

  // Call after any change to the cards. nextId = the card the preview should
  // show afterwards ('' closes it, e.g. when the last card was deleted).
  function afterCardsChanged(nextId) {
    try {
      NOW.game.rebuildQueues();
    } catch (err) {
      reportError(t('err.refresh_saved'), err);
    }
    ui.libOpenId = nextId;
    ui.libDirty = false;
    renderLibrary(false);
  }

  function neighborId() {
    const next = ui.libView[ui.libIndex + 1] || ui.libView[ui.libIndex - 1];
    return next ? next.q.id : '';
  }

  function deleteLibraryCard() {
    const item = ui.libView[ui.libIndex];
    if (!item || ui.libTrash) return;
    const question = item.q;
    const custom = !!question.custom;
    confirmAction({
      title: t(custom ? 'creator.del.title' : 'library.del.title'),
      message: custom ? t('creator.del.msg', { text: question.text }) : t('library.del.msg'),
      okLabel: t(custom ? 'creator.del.ok' : 'library.del.ok')
    }).then(function (ok) {
      if (!ok) return;
      const next = neighborId();
      if (custom) {
        persistCustomQuestions(readCustomQuestions().filter(function (c) { return c.id !== question.id; }));
      } else if (!NOW.questions.removeBuiltIn(question.id)) {
        warnNotPersisted();
      }
      afterCardsChanged(next);
    });
  }

  function restoreLibraryCard() {
    const item = ui.libView[ui.libIndex];
    if (!item || !ui.libTrash) return;
    const next = neighborId();
    if (!NOW.questions.restoreBuiltIn(item.q.id)) warnNotPersisted();
    afterCardsChanged(next);
  }

  function openLibraryEdit() {
    const item = ui.libView[ui.libIndex];
    if (!item || ui.libTrash) return;
    ui.libEditId = item.q.id;
    clearFieldError(el.libEditError, [el.libEditText]);
    el.libEditText.value = item.q.text;
    el.libEditDesc.value = item.q.description || '';
    el.libEditDiff.value = item.q.difficulty || '';
    el.libEditOriginal.hidden = !item.q.edited;
    openDialog(el.libEditDialog);
    try { el.libEditText.focus(); } catch (err) { /* ignore */ }
  }

  function currentEditItem() {
    for (let i = 0; i < ui.libView.length; i++) {
      if (ui.libView[i].q.id === ui.libEditId) return ui.libView[i];
    }
    return null;
  }

  function saveLibraryEdit(event) {
    event.preventDefault();
    const item = currentEditItem();
    if (!item) {
      closeDialog(el.libEditDialog);
      return;
    }
    const question = item.q;
    const text = el.libEditText.value.replace(/\s+/g, ' ').trim();
    const description = el.libEditDesc.value.replace(/\s+/g, ' ').trim();
    const difficulty = el.libEditDiff.value;

    if (!text) {
      showFieldError(el.libEditError, t('creator.err.empty'), el.libEditText);
      return;
    }
    if (Array.from(text).length < MIN_QUESTION_CHARS) {
      showFieldError(el.libEditError, t('creator.err.short', { min: MIN_QUESTION_CHARS }), el.libEditText);
      return;
    }
    if (text === question.text && description === (question.description || '') && difficulty === (question.difficulty || '')) {
      closeDialog(el.libEditDialog);
      return;
    }

    if (question.custom) {
      const list = readCustomQuestions();
      const target = list.filter(function (c) { return c.id === question.id; })[0];
      if (target) {
        target.text = text;
        target.description = description;
        target.difficulty = difficulty;
        persistCustomQuestions(list);
      }
    } else if (!NOW.questions.editBuiltIn(question.id, { text: text, description: description, difficulty: difficulty })) {
      warnNotPersisted();
    }
    closeDialog(el.libEditDialog);
    afterCardsChanged(question.id);
  }

  function restoreOriginalCard() {
    const item = currentEditItem();
    if (!item) {
      closeDialog(el.libEditDialog);
      return;
    }
    if (!NOW.questions.restoreOriginal(item.q.id)) warnNotPersisted();
    closeDialog(el.libEditDialog);
    afterCardsChanged(item.q.id);
  }

  function bindLibraryEditing() {
    el.libEdit.addEventListener('click', openLibraryEdit);
    el.libDelete.addEventListener('click', deleteLibraryCard);
    el.libRestore.addEventListener('click', restoreLibraryCard);
    el.libEditForm.addEventListener('submit', saveLibraryEdit);
    el.libEditCancel.addEventListener('click', function () { closeDialog(el.libEditDialog); });
    el.libEditClose.addEventListener('click', function () { closeDialog(el.libEditDialog); });
    el.libEditOriginal.addEventListener('click', restoreOriginalCard);
    el.libEditText.addEventListener('input', function () {
      clearFieldError(el.libEditError, [el.libEditText]);
    });
    el.libEditDialog.addEventListener('click', function (event) {
      if (event.target === el.libEditDialog) closeDialog(el.libEditDialog);
    });
  }

  function bindLibraryPreview() {
    el.libPrev.addEventListener('click', function () { stepPreview(-1); });
    el.libNext.addEventListener('click', function () { stepPreview(1); });
    el.libFav.addEventListener('click', toggleLibraryFavorite);
    el.libClose.addEventListener('click', function () { closeDialog(el.libDialog); });
    el.libDialog.addEventListener('close', handlePreviewClose);
    el.libDialog.addEventListener('click', function (event) {
      if (event.target === el.libDialog) closeDialog(el.libDialog);
    });
    el.libDialog.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepPreview(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); stepPreview(1); }
    });

    // Swipe left / right on the card.
    let swipe = null;
    el.libCard.addEventListener('pointerdown', function (event) {
      swipe = { x: event.clientX, y: event.clientY };
    });
    el.libCard.addEventListener('pointerup', function (event) {
      if (!swipe) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) stepPreview(dx < 0 ? 1 : -1);
    });
    el.libCard.addEventListener('pointercancel', function () { swipe = null; });
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

    el.libraryCount = need('library-count');
    el.librarySearch = need('library-search');
    el.libraryChips = need('library-chips');
    el.libraryGroups = need('library-groups');
    el.libraryEmpty = need('library-empty');
    el.libraryEmptyText = need('library-empty-text');
    el.libraryReset = need('library-reset');
    el.libraryClear = need('library-clear');
    el.libraryFilters = need('library-filters');
    el.libDialog = need('lib-dialog');
    el.libPos = need('lib-pos');
    el.libFav = need('lib-fav');
    el.libClose = need('lib-close');
    el.libPrev = need('lib-prev');
    el.libNext = need('lib-next');
    el.libCard = need('lib-card');
    el.libCardCat = need('lib-card-cat');
    el.libCardNum = need('lib-card-num');
    el.libCardText = need('lib-card-text');
    el.libCardNote = need('lib-card-note');
    el.libCardDiff = need('lib-card-diff');
    el.libEdit = need('lib-edit');
    el.libDelete = need('lib-delete');
    el.libRestore = need('lib-restore');
    el.libEditDialog = need('lib-edit-dialog');
    el.libEditForm = need('lib-edit-form');
    el.libEditText = need('lib-edit-text');
    el.libEditDiff = need('lib-edit-diff');
    el.libEditDesc = need('lib-edit-desc');
    el.libEditError = need('lib-edit-error');
    el.libEditOriginal = need('lib-edit-original');
    el.libEditCancel = need('lib-edit-cancel');
    el.libEditClose = need('lib-edit-close');

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
      renderLibrary();
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

    safely('library', function () {
      el.librarySearch.addEventListener('input', function () {
        ui.libQuery = el.librarySearch.value;
        renderLibrary(false);
      });
      el.libraryClear.addEventListener('click', clearLibrarySearch);
      el.libraryChips.addEventListener('click', handleLibraryChipClick);
      el.libraryFilters.addEventListener('click', handleLibraryFilterClick);
      el.libraryGroups.addEventListener('click', handleLibraryTileClick);
      el.libraryReset.addEventListener('click', resetLibraryFilters);
      bindLibraryPreview();
      bindLibraryEditing();
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
