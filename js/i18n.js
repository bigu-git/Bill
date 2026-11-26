/* ==========================================================================
   NOW OR NEVER — js/i18n.js
   Loaded right after storage.js. Provides:
     NOW.i18n   t(key, params), plural(base, n), getLang(), setLang(code),
                languages(), onChange(fn), apply(root), exists(key), register(code, dict)

   - English is the complete base dictionary (fallback for every missing key).
   - Other languages are added by js/lang-<code>.js through register().
   - Static HTML is translated through two attributes:
       data-i18n="key"                        sets textContent
       data-i18n-attr="aria-label:key;..."    sets attributes
   - The chosen language is saved in localStorage (key "lang"). First visit:
     Mongolian when the browser language is Mongolian, otherwise English.
   - No DOM access except in apply().
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});

  const LANGUAGES = Object.freeze([
    Object.freeze({ code: 'en', name: 'English' }),
    Object.freeze({ code: 'mn', name: 'Монгол' })
  ]);
  const STORE_KEY = 'lang';

  const dicts = {
    en: {
      'meta.title': 'NOW OR NEVER — Party Card Game',
      'meta.desc': 'NOW OR NEVER is a premium party card game for friends. One device, no sign-up, works offline. One card can change everything.',

      'common.back': 'Back to home',
      'confirm.title': 'Are you sure?',
      'confirm.msg': 'This action cannot be undone.',
      'confirm.ok': 'Confirm',
      'confirm.cancel': 'Cancel',

      'n.player.one': '{n} player', 'n.player.other': '{n} players',
      'n.card.one': '{n} card', 'n.card.other': '{n} cards',
      'n.more_player.one': '{n} more player', 'n.more_player.other': '{n} more players',

      'diff.none': 'None', 'diff.easy': 'Easy', 'diff.medium': 'Medium', 'diff.hard': 'Hard',
      'result.done': 'Done', 'result.skipped': 'Skipped', 'result.passed': 'Passed',

      'home.tagline': 'One card can change everything.',
      'home.menu': 'Main menu',
      'home.play': 'Play',
      'home.create': 'Create questions',
      'home.howto': 'How to play',
      'home.settings': 'Settings',
      'home.library': 'All cards',

      'library.title': 'All cards',
      'library.search': 'Search cards',
      'library.filter': 'Filter by category',
      'library.all': 'All',
      'library.empty': 'No cards match your search.',
      'library.custom': 'Custom',
      'library.off': 'Off in game',

      'setup.title': 'Who\'s playing?',
      'setup.lead': 'Add 2 to 12 players, then pass the phone around.',
      'setup.name': 'Player name',
      'setup.limit': 'Player limit reached',
      'setup.add': 'Add',
      'setup.players': 'Players',
      'setup.empty': 'Players you add will appear here.',
      'setup.start': 'Start game',
      'setup.ready': '{players} ready.',
      'setup.need_more': 'Add {more} to start.',
      'setup.err.empty': 'Enter a name first.',
      'setup.err.max': 'You can add up to {max} players.',
      'setup.err.dup': '{name} is already in the game. Use a different name.',
      'setup.toast.min': 'Add at least {min} players to start.',
      'setup.confirm.title': 'Start a new game?',
      'setup.confirm.msg': 'The current game and its history will be cleared. Players are kept.',
      'setup.confirm.ok': 'Start new game',
      'player.remove': 'Remove {name}',

      'play.title': 'Resume your game?',
      'play.msg': 'A game is in progress ({cards} drawn). Continue where you left off, or set up a new game.',
      'play.ok': 'Resume',
      'play.cancel': 'Set up new game',

      'game.now': 'Now playing',
      'game.history': 'Question history',
      'game.turn': 'Turn',
      'game.drawn': 'Cards drawn',
      'game.open_settings': 'Open settings',
      'game.chips': 'Available categories',
      'game.mode.random': 'Random category',
      'game.mode.manual': 'Choose a category',
      'game.draw': 'Draw card',
      'game.done': 'Done',
      'game.skip': 'Skip',
      'game.next': 'Next player',
      'card.hint.tap': 'Tap to draw',
      'card.hint.pick': 'Pick a category',
      'card.hint.none': 'No categories on',
      'card.hint.another': 'Pick another category',
      'card.aria.current': 'Current card',
      'card.aria.draw': 'Draw a card',
      'card.n': 'Card {n}.',
      'card.difficulty': 'Difficulty: {d}.',
      'toast.round': 'Round {n}',
      'toast.discarded': 'That player\'s card was discarded.',
      'toast.card_not_open': 'The card did not open. Tap it to try again.',

      'history.title': 'History',
      'history.close': 'Close history',
      'history.empty': 'No cards drawn yet.',
      'history.aria': 'Cards drawn this game',

      'creator.title': 'Create questions',
      'creator.new': 'New question',
      'creator.edit': 'Edit question',
      'creator.add': 'Add question',
      'creator.save': 'Save changes',
      'creator.q': 'Question or challenge',
      'creator.q_ph': 'Type your question or challenge',
      'creator.cat': 'Category',
      'creator.diff': 'Difficulty',
      'creator.optional': 'optional',
      'creator.desc': 'Description',
      'creator.desc_ph': 'A short hint or rule for this card',
      'creator.cancel': 'Cancel',
      'creator.yours': 'Your questions',
      'creator.filter': 'Filter by category',
      'creator.all': 'All categories',
      'creator.empty': 'No custom questions yet. Add your first one above.',
      'creator.empty_cat': 'No custom questions in this category.',
      'creator.in_game': 'In game',
      'creator.edit_btn': 'Edit question',
      'creator.delete_btn': 'Delete question',
      'creator.err.empty': 'Write a question or challenge first.',
      'creator.err.short': 'Make it a little longer (at least {min} characters).',
      'creator.err.cat': 'Choose a category for this question.',
      'creator.err.dup_builtin': 'This question already exists in {where}.',
      'creator.err.dup_custom': 'You already added this question to {where}.',
      'creator.toast.updated': 'Question updated.',
      'creator.toast.added': 'Question added.',
      'creator.toast.readded': 'The old question was gone, so this was added as a new one.',
      'creator.toast.deleted': 'Question deleted.',
      'creator.del.title': 'Delete this question?',
      'creator.del.msg': '"{text}" will be removed for good.',
      'creator.del.ok': 'Delete',

      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.categories': 'Categories',
      'settings.cat_help': 'Only enabled categories appear in the game.',
      'settings.enable': 'Enable {name}',
      'settings.selection': 'Category selection',
      'settings.random': 'Random',
      'settings.random_d': 'The game picks a category for every card.',
      'settings.manual': 'Manual',
      'settings.manual_d': 'The current player chooses a category before drawing.',
      'settings.questions': 'Questions',
      'settings.repeat': 'Allow repeated questions',
      'settings.repeat_d': 'Off: each question appears once before its category reshuffles.',
      'settings.reset': 'Reset',
      'settings.reset_game_help': 'Clears drawn cards, history and turn order. Players are kept.',
      'settings.reset_game': 'Reset game',
      'settings.reset_custom_help': 'Permanently deletes every question you created.',
      'settings.reset_custom': 'Reset custom questions',
      'toast.all_off': 'All categories are off. Turn one on to draw cards.',
      'toast.manual': 'Manual: pick a category before each draw.',
      'toast.random': 'Random: the game picks the category.',
      'reset.game.title': 'Reset the game?',
      'reset.game.msg': 'Drawn cards, history and turn order are cleared. Players and settings are kept.',
      'reset.game.ok': 'Reset game',
      'reset.game.done': 'Game reset. Players kept.',
      'reset.custom.title': 'Delete all custom questions?',
      'reset.custom.msg': 'Every question you created will be removed for good. Built-in questions stay.',
      'reset.custom.ok': 'Delete all',
      'reset.custom.done': 'Custom questions deleted.',

      'howto.title': 'How to play',
      'howto.s1.t': 'Gather your group.', 'howto.s1.d': 'Add 2 to 12 players. Everyone shares one device.',
      'howto.s2.t': 'Draw a card.', 'howto.s2.d': 'The current player taps Draw card. The card flips and reveals a question or challenge.',
      'howto.s3.t': 'Play it out.', 'howto.s3.d': 'Answer, perform, or follow the card. Tap Done when finished, or Skip if you pass.',
      'howto.s4.t': 'Pass the phone.', 'howto.s4.d': 'The turn moves to the next player automatically.',
      'howto.s5.t': 'Make it yours.', 'howto.s5.d': 'Add your own questions in Create questions. They appear in the game right away.',
      'howto.cats': 'The six categories',
      'howto.note': 'Play responsibly. Nobody should be pressured to answer, perform, or drink. Skipping is always allowed.',
      'howto.cat.spice': 'Bold, spicy, relationship-related questions.',
      'howto.cat.drink': 'Drinking challenges. Always optional: water, a skip, or an honest answer works too.',
      'howto.cat.free-pass': 'Skip, escape, or change the game.',
      'howto.cat.truth': 'Deep, personal, honest questions.',
      'howto.cat.challenge': 'Funny and creative dares.',
      'howto.cat.chaos': 'Random events that involve everyone.',

      'cat.spice.name': 'Spice', 'cat.spice.desc': 'Bold, uncomfortable relationship questions.',
      'cat.drink.name': 'Drink', 'cat.drink.desc': 'Drinking challenges. Every one has a non-alcoholic way to play.',
      'cat.free-pass.name': 'Free Pass', 'cat.free-pass.desc': 'Skip, give your turn away, cancel a challenge or choose another category.',
      'cat.truth.name': 'Truth', 'cat.truth.desc': 'Deep, personal, honest questions.',
      'cat.challenge.name': 'Challenge', 'cat.challenge.desc': 'Funny and creative challenges to perform.',
      'cat.chaos.name': 'Chaos', 'cat.chaos.desc': 'Random events that involve several players.',

      'msg.not-enough-players': 'Add at least 2 players to start the game.',
      'msg.not-started': 'The game has not started yet.',
      'msg.card-pending': 'Finish the current card before drawing another one.',
      'msg.no-categories': 'No category has questions available. Turn a category on in Settings or add questions.',
      'msg.no-category-selected': 'Pick a category to draw from.',
      'msg.category-unavailable': 'That category is turned off or has no questions. Pick another one.',
      'msg.no-card': 'There is no card to complete.',
      'msg.invalid-result': 'Unknown result.',

      'err.draw': 'Something went wrong drawing the card. Tap the card to try again.',
      'err.show': 'Could not show the card. Tap it to try again.',
      'err.complete': 'Something went wrong. The game was kept safe.',
      'err.history': 'Could not load the history.',
      'err.refresh_saved': 'Saved, but the game could not refresh its cards.',
      'err.refresh': 'Could not refresh the cards.',
      'err.screen': 'Could not open this screen.',
      'err.part': 'Part of the app failed to start ({label}).',
      'err.saved_data': 'Saved data could not be read. Starting fresh.',
      'toast.storage_changes': 'Storage is blocked. Changes last only until you close the page.',
      'toast.storage_boot': 'Storage is blocked in this browser. Progress will not be saved.'
    }
  };

  const listeners = [];

  function isLang(code) {
    return LANGUAGES.some(function (l) { return l.code === code; });
  }

  function detect() {
    try {
      const saved = NOW.storage ? NOW.storage.get(STORE_KEY, null) : null;
      if (typeof saved === 'string' && isLang(saved)) return saved;
    } catch (err) { /* fall through */ }
    const nav = String((global.navigator && (global.navigator.language || global.navigator.userLanguage)) || '');
    return /^mn\b/i.test(nav) ? 'mn' : 'en';
  }

  let lang = detect();

  function register(code, dict) {
    if (!isLang(code) || !dict || typeof dict !== 'object') return;
    dicts[code] = Object.assign(dicts[code] || {}, dict);
  }

  function exists(key) {
    return Object.prototype.hasOwnProperty.call(dicts.en, key);
  }

  function lookup(key) {
    const d = dicts[lang];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    return Object.prototype.hasOwnProperty.call(dicts.en, key) ? dicts.en[key] : undefined;
  }

  function format(text, params) {
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return params && params[name] !== undefined && params[name] !== null ? String(params[name]) : match;
    });
  }

  // Translates a key; returns the key itself when nothing is found.
  function t(key, params) {
    const text = lookup(key);
    return text === undefined ? key : format(text, params);
  }

  // base + ".one" / ".other" ({n} is filled in automatically).
  function plural(base, n, params) {
    return t(base + (n === 1 ? '.one' : '.other'), Object.assign({ n: n }, params || {}));
  }

  // Translates every [data-i18n] / [data-i18n-attr] element under `root`.
  function apply(root) {
    const doc = global.document;
    if (!doc) return;
    const scope = root || doc;

    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-attr]'), function (node) {
      node.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        const i = pair.indexOf(':');
        if (i < 1) return;
        node.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });

    doc.documentElement.setAttribute('lang', lang);
    doc.title = t('meta.title');
    const meta = doc.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta.desc'));
  }

  function getLang() { return lang; }

  // Switches language, saves it, re-translates the static HTML and tells listeners.
  function setLang(code) {
    if (!isLang(code) || code === lang) return false;
    lang = code;
    try { if (NOW.storage) NOW.storage.set(STORE_KEY, code); } catch (err) { /* memory only */ }
    apply();
    listeners.slice().forEach(function (fn) {
      try { fn(code); } catch (err) { /* a listener must never break the switch */ }
    });
    return true;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function languages() {
    return LANGUAGES.map(function (l) { return { code: l.code, name: l.name }; });
  }

  NOW.i18n = Object.freeze({
    t: t,
    plural: plural,
    exists: exists,
    register: register,
    apply: apply,
    getLang: getLang,
    setLang: setLang,
    onChange: onChange,
    languages: languages
  });
})(window);
