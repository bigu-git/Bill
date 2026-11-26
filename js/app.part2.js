
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

    el.modeLabel.textContent = manual ? 'Choose a category' : 'Random category';
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
    el.card.setAttribute('aria-label', active ? 'Current card' : 'Draw a card');

    let hint = 'Tap to draw';
    if (!check.ok && check.reason === 'no-category-selected') hint = 'Pick a category';
    else if (!check.ok && check.reason === 'no-categories') hint = 'No categories on';
    else if (!check.ok && check.reason === 'category-unavailable') hint = 'Pick another category';
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
      reportError('Something went wrong drawing the card. Tap the card to try again.', err);
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
      showToast('The card did not open. Tap it to try again.', 3200);
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
      reportError('Could not show the card. Tap it to try again.', err);
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
      if (res.ok && res.roundChanged) showToast('Round ' + res.round);
    } catch (err) {
      reportError('Something went wrong. The game was kept safe.', err);
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
        text: entry.categoryName || category.name
      }));
      meta.appendChild(make('span', { text: entry.playerName }));
      meta.appendChild(make('span', { text: RESULT_LABELS[entry.result] || entry.result }));
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
      reportError('Could not load the history.', err);
      return;
    }
    openDialog(el.historyDialog);
  }

  // Part 2 continues in part 3 (creator, settings, events, startup).
