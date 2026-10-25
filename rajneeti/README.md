# Rajneeti: Path to Power

An offline, single-player Indian political strategy game. Lead an opposition party to victory in the Lok Sabha, govern as Prime Minister for five years, then fight for re-election. All parties and leaders are fictional.

## Play
- **Quickest:** open `dist/index.html` in any browser. It's one self-contained file with no internet needed.
- **Install on a phone:** host the `dist/` folder on any static host (GitHub Pages, Netlify), open it, and choose "Add to Home Screen". The service worker caches it for offline play.

Progress auto-saves in the browser.

## Game phases
1. **Campaign (10 weeks):** pick 3 promises, then use 3 moves a week. Tap a state to hold a rally or win its local party as an ally, or make a national move (TV ads, fundraiser, attack the RSP).
2. **Counting day:** seat-by-seat first-past-the-post results.
3. **Hung parliament:** win kingmakers over by asking, offering a minister's post, or offering money for their state.
4. **Prime Minister (20 quarters):** each quarter, handle a crisis card and play one of 3 policy cards. Once a year, choose a budget (Populist, Balanced, Growth or Austerity). Keep your allies happy and watch popularity, the economy, prices, jobs and the treasury.
5. **Re-election:** your approval in each state becomes your starting position, and broken promises cost trust.

## Develop
Source is in `src/` (`data.js` content, `events.js` event cards, `engine.js` rules/economy, `ui.js` interface). Open `src/index.html` directly while editing, then run `node build.js` to regenerate `dist/`.
