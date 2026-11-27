/* ==========================================================================
   NOW OR NEVER — js/questions.js
   Loaded SECOND (after storage.js). Provides:
     NOW.questions   built-in categories + questions, merged with the
                     custom categories / custom questions kept in storage

   Design notes
   - Built-in data is frozen. Public functions return fresh arrays, so
     callers can sort or filter them without touching the source data.
   - Custom data is read from NOW.storage on every call, so edits made in
     the creator are visible immediately (no stale cache to invalidate).
   - Unknown category ids never throw: lookups fall back safely.
   - Question shape (same for built-in and custom):
     { id, category, text, description, difficulty, enabled, custom, createdAt }
     (built-in cards changed by the player also carry edited: true)
   ========================================================================== */
(function (global) {
  'use strict';

  const NOW = (global.NOW = global.NOW || {});

  /* ---------- Built-in categories (ids and colors are fixed by the contract) ---------- */
  const BUILT_IN_CATEGORIES = [
    {
      id: 'spice',
      name: 'Spice',
      color: '#C73545',
      description: 'Bold, uncomfortable relationship questions.'
    },
    {
      id: 'drink',
      name: 'Drink',
      color: '#171717',
      description: 'Drinking challenges. Every one has a non-alcoholic way to play.'
    },
    {
      id: 'free-pass',
      name: 'Free Pass',
      color: '#F0EEE8',
      description: 'Skip, give your turn away, cancel a challenge or choose another category.'
    },
    {
      id: 'truth',
      name: 'Truth',
      color: '#C7A15A',
      description: 'Deep, personal, honest questions.'
    },
    {
      id: 'challenge',
      name: 'Challenge',
      color: '#547A9B',
      description: 'Funny and creative challenges to perform.'
    },
    {
      id: 'chaos',
      name: 'Chaos',
      color: '#80669C',
      description: 'Random events that involve several players.'
    }
  ];

  /* ---------- Built-in questions ---------- */
  // Each entry: [text, difficulty, optional note shown under the text].
  // difficulty is '', 'easy', 'medium' or 'hard'.
  // Ids are generated as "<category>-01", "<category>-02", ...
  const NOTE_DRINK = 'Always optional. Water, juice or skipping counts.';

  const BUILT_IN_DATA = {
    spice: [
      ['What is the most romantic thing anyone has ever done for you?', 'easy'],
      ['What small habit in a partner instantly turns you off?', 'medium'],
      ['Which player here would you trust most to give you honest dating advice, and why?', 'medium'],
      ['Have you ever stayed in a relationship longer than you should have? What kept you there?', 'hard'],
      ['What is the most daring thing you have done to impress someone?', 'medium'],
      ['Describe your ideal first date in three sentences.', 'easy'],
      ['What is a green flag you only learned to appreciate with time?', 'medium'],
      ['Have you ever had feelings for someone you knew you should not? Share as much as you are comfortable with.', 'hard'],
      ['What is one thing you wish your last partner had understood about you?', 'medium'],
      ['Which player here do you think would be the most loyal partner? Explain your pick.', 'medium'],
      ['What is the cheesiest pick-up line you have ever used or received?', 'easy'],
      ['How soon is too soon to say "I love you"? Defend your answer.', 'easy'],
      ['What is your worst dating app or blind date disaster?', 'medium'],
      ['Which red flag do you think people ignore the most?', 'medium'],
      ['Have you ever sent a message you regretted instantly? Tell the story.', 'medium'],
      ['What would make you walk away from a relationship immediately?', 'hard'],
      ['What is your most unpopular opinion about love or dating?', 'medium'],
      ['Who was your first heartbreak, and what did it teach you?', 'hard']
    ],

    drink: [
      ['Anyone who has ever sent a text to the wrong person takes a sip. Not drinking? Sip water or tell the story instead.', 'easy', NOTE_DRINK],
      ['Make a toast with a made-up reason. Everyone sips along, and water, juice or soda counts just as well.', 'easy', NOTE_DRINK],
      ['Anyone wearing something black takes a sip. Prefer not to drink? Sip water or give someone a compliment instead.', 'easy', NOTE_DRINK],
      ['Never have I ever: say something you have never done. Anyone who has done it sips, or takes a sip of water instead.', 'medium', NOTE_DRINK],
      ['Everyone points at the person most likely to be late. They take a sip of any drink, or share their best excuse instead.', 'easy', NOTE_DRINK],
      ['If you have ever fallen asleep during a movie, sip. Skip the drink and name your favorite movie instead.', 'easy', NOTE_DRINK],
      ['Rock, paper, scissors against the player on your left. The loser sips, or takes water and answers a light question instead.', 'easy', NOTE_DRINK],
      ['Whoever has the lowest phone battery sips. No alcohol? Water works, or plug in and tell everyone your screen time.', 'easy', NOTE_DRINK],
      ['If you have ever pretended to know a song\u2019s lyrics, sip. Water counts, or hum the chorus instead of drinking.', 'easy', NOTE_DRINK],
      ['Category battle: pick a topic, then go around naming items. Whoever stalls sips or takes water, then picks the next topic.', 'medium', NOTE_DRINK],
      ['If you have ever laughed at the worst possible moment, sip. Or skip the drink and tell the story instead.', 'easy', NOTE_DRINK],
      ['Everyone who has traveled abroad this year sips, or takes water. The rest name a dream destination.', 'easy', NOTE_DRINK],
      ['Say "she sells seashells by the seashore" three times fast. Fail and you sip, or sip water and try once more.', 'medium', NOTE_DRINK],
      ['Staring contest with a player of your choice. The loser sips or takes a water sip, and the winner picks the next toast.', 'medium', NOTE_DRINK],
      ['If you have ever eaten dessert before dinner, sip. Water counts, or share your favorite dessert instead.', 'easy', NOTE_DRINK],
      ['On your shout of "Now!", the last person to touch their nose sips, or takes water and does a tiny victory dance.', 'easy', NOTE_DRINK],
      ['Name a country; the next player names one starting with its last letter. Whoever stalls sips, or sips water and goes again.', 'medium', NOTE_DRINK],
      ['Cheers round: everyone clinks, says one thing they are thankful for, and sips whatever they like, water included.', 'easy', NOTE_DRINK]
    ],

    'free-pass': [
      ['Skip Pass: save this card. Later, say "Free Pass" out loud to skip any one question or challenge.', ''],
      ['Hand It Over: give your next turn to any player. They take it, then play continues as normal.', ''],
      ['Rewind: cancel the last challenge given to anyone, including yourself. No penalty, no explanation.', ''],
      ['Your Pick: choose the category of the next card and say it out loud before the draw.', ''],
      ['Gift of Mercy: give this card to another player. They may skip their next challenge.', ''],
      ['Force Field: until your next turn, nobody can give you a dare or a challenge.', ''],
      ['Tag Team: pick a partner. For your next card, they answer or perform it instead of you.', ''],
      ['Take Five: everyone takes a 30-second break to stretch, hydrate or check messages. Then play on.', ''],
      ['Second Chance: take back one card you skipped earlier and answer it now, or pass this card to a friend.', ''],
      ['Audience Vote: ask the group whether you should answer your next card or skip it. The majority decides.', ''],
      ['Deal Me Out: skip this whole turn without penalty and hand the device to the next player.', ''],
      ['Category Roulette: name any category. The next player must draw from it.', ''],
      ['Lifeline: ask any player to help with your next question. They may answer in your place.', ''],
      ['Peace Treaty: save this card. If a Chaos card affects you later, it is cancelled.', ''],
      ['Pay It Forward: give a free skip to the player on your right. They may use it at any moment.', ''],
      ['Double Skip: your next two cards can be skipped with no penalty. Say "Free Pass" each time.', ''],
      ['Chain Breaker: cancel any ongoing group challenge or Chaos effect. Everyone moves on.', ''],
      ['Everyone Skips: each player may skip their next card once. Announce it before reading the card.', '']
    ],

    truth: [
      ['What moment in your life are you most proud of, and why?', 'easy'],
      ['Which fear do you hide best from other people?', 'hard'],
      ['What is something you wish you had said to someone but never did?', 'hard'],
      ['When did you last cry, and what caused it?', 'medium'],
      ['What is a lie you told that you still think about?', 'hard'],
      ['Which of your habits would you most like to change?', 'medium'],
      ['What do you most appreciate about the person on your left?', 'easy'],
      ['What is the biggest risk you have ever taken, and was it worth it?', 'medium'],
      ['What did you want to be when you were little, and how close are you now?', 'easy'],
      ['What is a compliment you can still remember word for word?', 'easy'],
      ['Who do you miss the most right now?', 'medium'],
      ['What is something you are secretly very good at?', 'easy'],
      ['What would you do differently if you could redo last year?', 'medium'],
      ['What is the kindest thing a stranger has ever done for you?', 'easy'],
      ['What do you think people most misunderstand about you?', 'medium'],
      ['What is something you have forgiven someone for, and how did you do it?', 'hard'],
      ['What does a perfect day look like for you?', 'easy'],
      ['What is a dream you stopped chasing, and do you miss it?', 'hard']
    ],

    challenge: [
      ['Do your best impression of another player. The group guesses who it is.', 'easy'],
      ['Speak in a movie-trailer voice until your next turn.', 'medium'],
      ['Sing your favorite song like an opera singer for 15 seconds.', 'medium'],
      ['Invent a handshake with the player on your right, then perform it together.', 'easy'],
      ['Make up a 30-second commercial for an object within reach.', 'medium'],
      ['Act out a movie scene without speaking. The others guess the film.', 'medium'],
      ['Tell a five-sentence story where each sentence starts with the next letter of the alphabet, beginning with A.', 'hard'],
      ['Stand like a statue for 20 seconds while the others try to make you laugh.', 'medium'],
      ['Speak only in questions until your next turn.', 'hard'],
      ['Draw a portrait of the player across from you using your non-dominant hand. Show everyone.', 'easy'],
      ['Report something that happened today like a dramatic news anchor.', 'medium'],
      ['Mime your morning routine in 20 seconds. The group guesses each step.', 'easy'],
      ['Give a one-minute motivational speech about a random household item.', 'hard'],
      ['Tell a joke. If nobody laughs, try again, up to three jokes.', 'easy'],
      ['Walk like a runway model across the room and back.', 'easy'],
      ['Rap your introduction using at least three rhymes.', 'hard'],
      ['Build the tallest tower you can in 30 seconds using only objects nearby.', 'medium'],
      ['Speak in an accent of your choice until your next turn.', 'medium']
    ],

    chaos: [
      ['Everyone points at the player most likely to become famous. That player takes a bow and explains what for.', 'easy'],
      ['Everyone swaps places with the player on their left. Play on from the new seats.', 'easy'],
      ['Nobody may say the word "yes" until your next turn. Whoever slips gives the group a compliment.', 'medium'],
      ['Everyone closes their eyes and points at who would survive longest on a deserted island. The most-pointed player shares their survival plan.', 'medium'],
      ['Silent round: nobody may speak until your next turn. Communicate with gestures only.', 'medium'],
      ['Everyone describes, without showing, the last photo they took. The group guesses the funniest one.', 'easy'],
      ['Compliment chain: starting with you, each player gives a compliment to the person on their left.', 'easy'],
      ['Pick one player. You both share two truths and one lie, and the group guesses the lies.', 'medium'],
      ['Thumb war against a player of your choice. The loser tells the group a fun fact.', 'easy'],
      ['Rhyme chain: say a word, and each player rhymes with the previous one. Whoever stalls gives a compliment.', 'medium'],
      ['Hot seat: choose a player who must answer three rapid-fire questions from the group. Keep them fun.', 'medium'],
      ['Freeze! On your signal, everybody freezes in place. The first to move tells a joke.', 'easy'],
      ['Everyone whispers until the next turn, even for questions and cheers.', 'easy'],
      ['Group story: you say the first sentence, then each player adds one sentence around the circle.', 'medium'],
      ['Name swap: pick two players. They answer to each other\u2019s names until your next turn.', 'medium'],
      ['Album cover: everyone poses together for a dramatic fake album cover. Vote for the best pose.', 'easy'],
      ['Start a wave with the player on your right. The last one to join in picks someone to tell a short story.', 'easy'],
      ['Everyone shares the song they would play at a surprise party, then the group picks the winner.', 'easy']
    ]
  };

  /* ---------- Build frozen built-in structures once ---------- */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // category id -> frozen array of frozen question objects
  const BUILT_IN_QUESTIONS = {};

  BUILT_IN_CATEGORIES.forEach(function (cat) {
    const rows = BUILT_IN_DATA[cat.id] || [];
    BUILT_IN_QUESTIONS[cat.id] = Object.freeze(
      rows.map(function (row, index) {
        return Object.freeze({
          id: cat.id + '-' + pad2(index + 1),
          category: cat.id,
          text: row[0],
          description: row[2] || '',
          difficulty: row[1] || '',
          enabled: true,
          custom: false,
          createdAt: 0
        });
      })
    );
  });

  const BUILT_IN_IDS = new Set(BUILT_IN_CATEGORIES.map(function (c) { return c.id; }));

  /* ---------- Edits to built-in cards ---------- */
  // Built-in cards live in code, so the player's changes are stored on top of
  // them (localStorage key "edits"):
  //   { removed: [id, ...], changed: { id: { text, description, difficulty } } }
  // "removed" cards are hidden from the game (and can be restored);
  // "changed" cards replace the text / note / difficulty in every language.
  const EDITS_KEY = 'edits';
  const DIFFICULTIES = ['', 'easy', 'medium', 'hard'];
  const BUILT_IN_BY_ID = Object.create(null);
  BUILT_IN_CATEGORIES.forEach(function (c) {
    BUILT_IN_QUESTIONS[c.id].forEach(function (item) { BUILT_IN_BY_ID[item.id] = item; });
  });

  function cleanText(value, max) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }

  // Never throws; bad or missing data gives "no edits".
  function readEdits() {
    const removed = new Set();
    const changed = Object.create(null);
    let raw = null;
    try {
      raw = NOW.storage ? NOW.storage.get(EDITS_KEY, null) : null;
    } catch (err) {
      raw = null;
    }
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.removed)) {
        raw.removed.forEach(function (id) {
          if (typeof id === 'string' && BUILT_IN_BY_ID[id]) removed.add(id);
        });
      }
      if (raw.changed && typeof raw.changed === 'object') {
        Object.keys(raw.changed).forEach(function (id) {
          const c = raw.changed[id];
          if (!BUILT_IN_BY_ID[id] || !c || typeof c !== 'object') return;
          const text = cleanText(c.text, (NOW.config && NOW.config.TEXT_MAX) || 200);
          if (!text) return;
          changed[id] = {
            text: text,
            description: cleanText(c.description, (NOW.config && NOW.config.DESC_MAX) || 120),
            difficulty: DIFFICULTIES.indexOf(c.difficulty) !== -1 ? c.difficulty : ''
          };
        });
      }
    }
    return { removed: removed, changed: changed };
  }

  // Returns true when the value reached localStorage.
  function writeEdits(state) {
    try {
      const changed = {};
      Object.keys(state.changed).forEach(function (id) { changed[id] = state.changed[id]; });
      return !!NOW.storage.set(EDITS_KEY, { removed: Array.from(state.removed), changed: changed });
    } catch (err) {
      return false;
    }
  }

  // Applies the player's changes to a list of built-in cards (removed cards are dropped).
  function applyEdits(list, edits) {
    const out = [];
    list.forEach(function (item) {
      if (edits.removed.has(item.id)) return;
      const c = edits.changed[item.id];
      out.push(c
        ? Object.freeze(Object.assign({}, item, {
            text: c.text,
            description: c.description,
            difficulty: c.difficulty,
            edited: true
          }))
        : item);
    });
    return out;
  }

  /* ---------- Helpers ---------- */

  function cleanCategoryId(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // Translated text for a built-in category (falls back to the English source).
  function tr(key, fallback) {
    try {
      if (NOW.i18n && NOW.i18n.exists(key)) return NOW.i18n.t(key);
    } catch (err) { /* use the fallback */ }
    return fallback;
  }

  function toCategory(src, isBuiltIn) {
    return {
      id: src.id,
      name: isBuiltIn ? tr('cat.' + src.id + '.name', src.name) : src.name,
      color: src.color,
      description: isBuiltIn ? tr('cat.' + src.id + '.desc', src.description || '') : (src.description || ''),
      builtIn: isBuiltIn
    };
  }

  // Custom categories from storage (reserved feature). Never throws.
  function readCustomCategories() {
    try {
      if (NOW.storage && typeof NOW.storage.loadCustomCategories === 'function') {
        return NOW.storage.loadCustomCategories();
      }
    } catch (err) {
      // fall through to the empty default
    }
    return [];
  }

  // Custom questions from storage. Never throws.
  function readCustomQuestions() {
    try {
      if (NOW.storage && typeof NOW.storage.loadCustomQuestions === 'function') {
        return NOW.storage.loadCustomQuestions();
      }
    } catch (err) {
      // fall through to the empty default
    }
    return [];
  }

  /* ---------- Categories ---------- */

  // Built-in categories first (fixed order), then stored custom categories.
  // A custom category can never replace a built-in id.
  function getCategories() {
    const list = BUILT_IN_CATEGORIES.map(function (c) { return toCategory(c, true); });
    readCustomCategories().forEach(function (c) {
      if (!BUILT_IN_IDS.has(c.id)) list.push(toCategory(c, false));
    });
    return list;
  }

  function hasCategory(id) {
    const key = cleanCategoryId(id);
    if (!key) return false;
    return getCategories().some(function (c) { return c.id === key; });
  }

  // Always returns an object, so callers can read .name / .color safely.
  // Unknown ids get a neutral fallback (flagged with unknown: true).
  function getCategory(id) {
    const key = cleanCategoryId(id);
    const found = getCategories().filter(function (c) { return c.id === key; })[0];
    if (found) return found;
    return {
      id: key || 'unknown',
      name: 'Unknown',
      color: '#6B6B6B',
      description: '',
      builtIn: false,
      unknown: true
    };
  }

  function categoryName(id) {
    return getCategory(id).name;
  }

  /* ---------- Questions ---------- */

  // Built-in questions in the current language. Ids and difficulty never change;
  // only text and the note come from NOW.questionTexts[lang] (js/questions-<lang>.js).
  const localizedCache = {}; // lang -> category id -> frozen list

  function builtInFor(key) {
    const base = BUILT_IN_QUESTIONS[key];
    if (!base) return [];
    const code = NOW.i18n ? NOW.i18n.getLang() : 'en';
    const pack = NOW.questionTexts && NOW.questionTexts[code];
    const rows = pack && pack[key];
    if (code === 'en' || !Array.isArray(rows)) return base;

    const byLang = localizedCache[code] || (localizedCache[code] = {});
    if (!byLang[key]) {
      const note = pack.notes && pack.notes[key];
      byLang[key] = Object.freeze(base.map(function (q, index) {
        return Object.freeze(Object.assign({}, q, {
          text: typeof rows[index] === 'string' && rows[index] ? rows[index] : q.text,
          description: q.description && note ? note : q.description
        }));
      }));
    }
    return byLang[key];
  }

  // Built-in questions of one category (a copy of the list; items are frozen).
  function getBuiltIn(categoryId) {
    const key = cleanCategoryId(categoryId);
    return BUILT_IN_QUESTIONS[key] ? applyEdits(builtInFor(key), readEdits()) : [];
  }

  // Shared collector. Without a category id it covers every category.
  function collect(categoryId, includeDisabled) {
    const key = cleanCategoryId(categoryId);
    const edits = readEdits();
    let result = [];

    if (key) {
      result = BUILT_IN_QUESTIONS[key] ? applyEdits(builtInFor(key), edits) : [];
    } else {
      BUILT_IN_CATEGORIES.forEach(function (c) {
        result = result.concat(applyEdits(builtInFor(c.id), edits));
      });
    }

    const custom = readCustomQuestions()
      .filter(function (q) { return !key || q.category === key; })
      .filter(function (q) { return includeDisabled || q.enabled; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });

    return result.concat(custom);
  }

  // Questions the game may draw: built-ins + ENABLED custom questions.
  function getAll(categoryId) {
    return collect(categoryId, false);
  }

  // Everything the creator list shows: built-ins + ALL custom questions.
  function getAllIncludingDisabled(categoryId) {
    return collect(categoryId, true);
  }

  // Finds one question by id (game.js uses this to validate saved queues).
  // Disabled custom questions are skipped unless includeDisabled is true.
  function getById(id, includeDisabled) {
    if (typeof id !== 'string' || !id) return null;
    const all = collect('', includeDisabled === true);
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  /* ---------- Editing built-in cards ---------- */
  // Each function returns true when the change was saved to localStorage.

  function isBuiltInId(id) {
    return typeof id === 'string' && !!BUILT_IN_BY_ID[id];
  }

  // Built-in cards the player removed (with their edits applied), in card order.
  function getRemoved() {
    const edits = readEdits();
    const onlyChanges = { removed: new Set(), changed: edits.changed };
    let out = [];
    BUILT_IN_CATEGORIES.forEach(function (c) {
      out = out.concat(applyEdits(builtInFor(c.id), onlyChanges).filter(function (item) {
        return edits.removed.has(item.id);
      }));
    });
    return out;
  }

  function editBuiltIn(id, data) {
    if (!isBuiltInId(id) || !data) return false;
    const text = cleanText(data.text, (NOW.config && NOW.config.TEXT_MAX) || 200);
    if (!text) return false;
    const state = readEdits();
    state.changed[id] = {
      text: text,
      description: cleanText(data.description, (NOW.config && NOW.config.DESC_MAX) || 120),
      difficulty: DIFFICULTIES.indexOf(data.difficulty) !== -1 ? data.difficulty : ''
    };
    return writeEdits(state);
  }

  // Drops the player's changes to one card (back to the original text).
  function restoreOriginal(id) {
    if (!isBuiltInId(id)) return false;
    const state = readEdits();
    delete state.changed[id];
    return writeEdits(state);
  }

  function removeBuiltIn(id) {
    if (!isBuiltInId(id)) return false;
    const state = readEdits();
    state.removed.add(id);
    return writeEdits(state);
  }

  function restoreBuiltIn(id) {
    if (!isBuiltInId(id)) return false;
    const state = readEdits();
    state.removed.delete(id);
    return writeEdits(state);
  }

  /* ---------- Public API ---------- */
  NOW.questions = Object.freeze({
    getCategories: getCategories,
    getCategory: getCategory,
    hasCategory: hasCategory,
    categoryName: categoryName,
    getBuiltIn: getBuiltIn,
    getAll: getAll,
    getAllIncludingDisabled: getAllIncludingDisabled,
    getById: getById,
    isBuiltInId: isBuiltInId,
    getRemoved: getRemoved,
    editBuiltIn: editBuiltIn,
    restoreOriginal: restoreOriginal,
    removeBuiltIn: removeBuiltIn,
    restoreBuiltIn: restoreBuiltIn
  });
})(window);
