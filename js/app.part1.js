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
  const RESULT_LABELS = { done: 'Done', skipped: 'Skipped', passed: 'Passed' };
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

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
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
      el.confirmTitle.textContent = opts.title || 'Are you sure?';
      el.confirmMessage.textContent = opts.message || 'This action cannot be undone.';
      el.confirmOk.textContent = opts.okLabel || 'Confirm';
      el.confirmCancel.textContent = opts.cancelLabel || 'Cancel';
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
      reportError('Could not open this screen.', err);
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
      title: 'Resume your game?',
      message: 'A game is in progress (' + plural(game.getCardsDrawn(), 'card') +
        ' drawn). Continue where you left off, or set up a new game.',
      okLabel: 'Resume',
      cancelLabel: 'Set up new game',
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
      item.appendChild(makeIconButton('trash', 'Remove ' + player.name, 'icon-btn--danger'));
      el.playerList.appendChild(item);
    });

    el.playerCount.textContent = players.length + ' / ' + max;
    el.playerEmpty.hidden = players.length > 0;

    const full = players.length >= max;
    el.playerInput.disabled = full;
    el.btnAddPlayer.disabled = full;
    el.playerInput.placeholder = full ? 'Player limit reached' : 'Player name';

    const ready = players.length >= min;
    el.btnStartGame.disabled = !ready;
    if (ready) {
      el.setupHint.textContent = plural(players.length, 'player') + ' ready. Start when you are.';
    } else {
      const missing = min - players.length;
      el.setupHint.textContent = 'Add ' + (players.length ? plural(missing, 'more player') : 'at least ' + min + ' players') + ' to start.';
    }
  }

  // Saves a new player list through NOW.game.setPlayers and fixes the UI.
  function commitPlayers(list) {
    const result = NOW.game.setPlayers(list);
    if (result.cardDiscarded) {
      // The drawn card belonged to a removed player: put the card back.
      ui.cardShown = false;
      NOW.cards.resetCard();
      showToast('That player\'s card was discarded.');
    }
    if (!result.persisted) warnNotPersisted();
    return result;
  }

  function warnNotPersisted() {
    showToast('Storage is blocked. Changes last only until you close the page.', 4500);
  }

  function handlePlayerSubmit(event) {
    event.preventDefault();
    clearFieldError(el.playerError, [el.playerInput]);

    const name = NOW.storage.cleanText(el.playerInput.value, NOW.config.NAME_MAX);
    const players = NOW.game.getPlayers();

    if (!name) {
      showFieldError(el.playerError, 'Enter a name first.', el.playerInput);
      el.playerInput.focus();
      return;
    }
    if (players.length >= NOW.config.MAX_PLAYERS) {
      showFieldError(el.playerError, 'You can add up to ' + NOW.config.MAX_PLAYERS + ' players.', el.playerInput);
      return;
    }
    const lower = name.toLowerCase();
    const duplicate = players.some(function (p) { return p.name.toLowerCase() === lower; });
    if (duplicate) {
      showFieldError(el.playerError, name + ' is already in the game. Use a different name.', el.playerInput);
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
      showToast('Add at least ' + NOW.config.MIN_PLAYERS + ' players to start.');
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
        title: 'Start a new game?',
        message: 'The current game and its history will be cleared. Players are kept.',
        okLabel: 'Start new game'
      }).then(function (ok) { if (ok) begin(); });
    } else {
      begin();
    }
  }

  // Part 1 continues in part 2 (game screen), then part 3.
