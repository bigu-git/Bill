
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
      reportError('Saved, but the game could not refresh its cards.', err);
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

  // question = custom question object to edit, or null for "new question".
  function setEditMode(question) {
    const editing = !!question;
    ui.editingId = editing ? question.id : '';
    el.questionId.value = ui.editingId;
    el.formTitle.textContent = editing ? 'Edit question' : 'New question';
    el.btnSaveQuestion.textContent = editing ? 'Save changes' : 'Add question';
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
      showFieldError(el.questionError, 'Write a question or challenge first.', el.questionText);
      el.questionText.focus();
      return;
    }
    if (Array.from(text).length < MIN_QUESTION_CHARS) {
      showFieldError(el.questionError, 'Make it a little longer (at least ' + MIN_QUESTION_CHARS + ' characters).', el.questionText);
      el.questionText.focus();
      return;
    }
    if (!category || !NOW.questions.hasCategory(category)) {
      showFieldError(el.questionError, 'Choose a category for this question.', el.questionCategory);
      el.questionCategory.focus();
      return;
    }
    const duplicate = isDuplicateQuestion(text, category, ui.editingId);
    if (duplicate) {
      const where = NOW.questions.categoryName(category);
      showFieldError(el.questionError, duplicate === 'built-in'
        ? 'This question already exists in ' + where + '.'
        : 'You already added this question to ' + where + '.', el.questionText);
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
      message = 'Question updated.';
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
      message = ui.editingId ? 'The old question was gone, so this was added as a new one.' : 'Question added.';
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
      ? 'No custom questions in this category.'
      : 'No custom questions yet. Add your first one above.';
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
    toggle.appendChild(make('span', { text: 'In game' }));
    actions.appendChild(toggle);
    actions.appendChild(makeIconButton('edit', 'Edit question', ''));
    actions.appendChild(makeIconButton('trash', 'Delete question', 'icon-btn--danger'));
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
        title: 'Delete this question?',
        message: '"' + question.text + '" will be removed for good.',
        okLabel: 'Delete'
      }).then(function (ok) {
        if (!ok) return;
        const rest = readCustomQuestions().filter(function (q) { return q.id !== id; });
        persistCustomQuestions(rest);
        if (ui.editingId === id) setEditMode(null);
        renderCustomList();
        showToast('Question deleted.');
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
        attrs: { type: 'checkbox', role: 'switch', 'aria-label': 'Enable ' + category.name },
        dataset: { id: category.id }
      });
      input.checked = !disabled.has(category.id);
      li.appendChild(input);
      el.settingsCategories.appendChild(li);
    });

    el.modeRandom.checked = settings.categoryMode !== 'manual';
    el.modeManual.checked = settings.categoryMode === 'manual';
    el.settingRepeat.checked = settings.allowRepeat === true;
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
      showToast('All categories are off. Turn one on to draw cards.', 3500);
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
    showToast(manual ? 'Manual: pick a category before each draw.' : 'Random: the game picks the category.');
  }

  function handleRepeatChange() {
    NOW.game.updateSettings({ allowRepeat: el.settingRepeat.checked });
  }

  function handleResetGame() {
    confirmAction({
      title: 'Reset the game?',
      message: 'Drawn cards, history and turn order are cleared. Players and settings are kept.',
      okLabel: 'Reset game'
    }).then(function (ok) {
      if (!ok) return;
      return resetGameView().then(function () { showToast('Game reset. Players kept.'); });
    });
  }

  function handleResetCustom() {
    confirmAction({
      title: 'Delete all custom questions?',
      message: 'Every question you created will be removed for good. Built-in questions stay.',
      okLabel: 'Delete all'
    }).then(function (ok) {
      if (!ok) return;
      NOW.storage.resetCustomQuestions();
      try { NOW.game.rebuildQueues(); } catch (err) { reportError('Could not refresh the cards.', err); }
      if (ui.editingId) setEditMode(null);
      renderCustomList();
      renderSettings();
      showToast('Custom questions deleted.');
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
      reportError('Part of the app failed to start (' + label + ').', err);
    }
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
    const parts = ['config', 'storage', 'questions', 'cards', 'game'];
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

    try {
      NOW.game.init();
    } catch (err) {
      reportError('Saved data could not be read. Starting fresh.', err);
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
      showToast('Storage is blocked in this browser. Progress will not be saved.', 5000);
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
