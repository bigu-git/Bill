# NOW OR NEVER

**One card can change everything.**

NOW OR NEVER is a mobile-first party card game for friends, couples and groups. Everyone shares one device and takes turns drawing virtual cards. Each card has a category color and reveals a question or challenge with a 3D flip. It is not a poker or playing-card game.

Plain HTML, CSS and JavaScript. No frameworks, no build step, no backend, no account.

---

## Features

- **6 categories**, each with 18 built-in questions: Spice, Drink, Free Pass, Truth, Challenge, Chaos.
- **2 to 12 players** on one device, with automatic turn rotation and rounds.
- **3D card flip** with a clear Done / Skip / Next player flow.
- **Custom questions**: create, edit, enable/disable and delete your own. They appear in real gameplay.
- **Settings**: turn categories on or off, random or manual category choice, allow or forbid repeated questions.
- **History** of the cards drawn in the current game.
- **Resume**: players, settings, custom questions and the running game are saved in the browser.
- **Drink cards are always optional**: every one carries a non-alcoholic alternative.
- Respects `prefers-reduced-motion`, supports keyboard play (Enter / Space on the card) and announces the revealed card to screen readers.

## Categories

| Id | Name | Color | Idea |
| --- | --- | --- | --- |
| `spice` | Spice | `#C73545` | Bold, uncomfortable relationship questions |
| `drink` | Drink | `#171717` | Drinking challenges, always optional |
| `free-pass` | Free Pass | `#F0EEE8` | Skip, give your turn away, change the game |
| `truth` | Truth | `#C7A15A` | Deep, personal, honest questions |
| `challenge` | Challenge | `#547A9B` | Funny and creative dares |
| `chaos` | Chaos | `#80669C` | Random events that involve everyone |

## How to play

1. Press **Play** and add 2 to 12 players (names must be unique, case-insensitive).
2. Press **Start game**.
3. The current player taps the card (or **Draw card**). The card flips.
4. Read it out and play it. Press **Done** or **Skip** to record the result, or **Next player** to pass the turn without marking the card.
5. The turn moves on automatically. The **History** button lists every card so far.

If a game is already in progress, **Play** offers to resume it or set up a new one.

## File structure

```
/
├── index.html
├── README.md
├── css/
│   ├── style.css
│   └── responsive.css
└── js/
    ├── storage.js     localStorage wrapper, shared config (NOW.config, NOW.storage)
    ├── questions.js   categories and built-in questions (NOW.questions)
    ├── cards.js       card flip (NOW.cards)
    ├── game.js        turns, draws, history, settings logic (NOW.game, no DOM access)
    └── app.js         screens, forms, dialogs, events, startup
```

`style.css` must live at `css/style.css`, because `index.html` links it there. The scripts are plain `<script defer>` tags (no ES modules) and must load in this order: `storage`, `questions`, `cards`, `game`, `app`.

## Run locally

1. Download or clone the repository.
2. Open `index.html` in a browser.

Opening the file directly should work because there are no modules or network requests. If your browser blocks storage for local files, use a tiny local server instead, for example `python3 -m http.server` in the project folder, then open `http://localhost:8000`.

## Deploy on GitHub Pages

1. Create a new repository on GitHub and upload all files, keeping the folder structure above. `index.html` must be in the repository root.
2. Open the repository **Settings**.
3. Open **Pages** in the sidebar.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose branch **main** and folder **/ (root)**, then press **Save**.
6. Wait a minute or two. The site is then available at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## Add built-in questions

Open `js/questions.js` and find `BUILT_IN_DATA`. Each category is an array of rows:

```js
[text, difficulty, optionalNote]
```

- `text`: the question or challenge.
- `difficulty`: `''`, `'easy'`, `'medium'` or `'hard'`.
- `optionalNote`: small text shown under the question. Drink rows use the `NOTE_DRINK` constant ("Always optional. Water, juice or skipping counts.").

Example:

```js
truth: [
  // ...existing rows...
  ['What is a skill you wish you had learned as a kid?', 'easy']
]
```

Ids are generated from the row position (`truth-01`, `truth-02`, ...). Add new rows at the END of a category so existing ids stay the same. Keep every Drink row optional-friendly. To add a new built-in category you would also have to change `BUILT_IN_CATEGORIES` and add matching `[data-cat]` rules in `css/style.css`; this is not covered by the UI.

## How data is stored

Everything stays in your browser's `localStorage`. Nothing is sent to a server. Keys use the prefix `nonv1:`:

| Key | Content |
| --- | --- |
| `nonv1:players` | the player list (`{ id, name }`) |
| `nonv1:settings` | disabled categories, category mode, manual category, allow-repeat |
| `nonv1:custom` | your custom questions |
| `nonv1:game` | game progress: turn, round, history, pending card, question queues |
| `nonv1:categories` | reserved for future custom categories (no UI yet) |

Each value is saved as JSON in the form `{ "v": 1, "data": ... }`. Data that is missing or damaged is replaced with safe defaults instead of crashing the game. If the browser blocks `localStorage` (for example in some private modes), the game keeps working from memory and shows a warning that progress will be lost when the page closes.

Custom questions are stored in `nonv1:custom` and are only on the device and browser that created them. To remove them all, use **Settings > Reset custom questions**. Clearing the site data in your browser also deletes everything.

## Known limitations

What was really verified, and what was not:

- **Checked:** all JavaScript files pass `node --check` (syntax only). Every element id used by `app.js` exists in `index.html`. A smoke test with a hand-written fake DOM ran the real scripts through adding players, starting a game, drawing and finishing a card, the history list, saving a custom question and switching to manual mode, and passed.
- **Not checked:** the game has not been run in a real browser by the author of these files. That means real card-flip animation timing, layout on real phones and tablets, touch behavior, screen reader output and `localStorage` persistence across an actual page refresh are untested. Please try it on your own phone before a party.
- **Offline:** there is no service worker. The game keeps working after the page has loaded, and when opened from local files, but a first visit while offline will not load it.
- **One device, no sync:** players, questions and progress are not shared between devices or browsers.
- **Back button:** there is no browser-history handling. The phone's back button leaves the page instead of going to the previous screen.
- **History limit:** the history keeps the most recent 500 cards.
- **Editing built-in questions after a game has started:** ids come from row position, so changing the middle of a category can shift ids. Finish or reset the running game first (Settings > Reset game).
- **Custom categories** exist in the storage layer only. There is no screen to create them yet.

## Responsible play

NOW OR NEVER is meant for entertainment. Nobody should be pressured to answer, perform or drink. Skipping is always allowed, and drinking cards can always be played with water or juice instead.
