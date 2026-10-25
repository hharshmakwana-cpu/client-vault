# Rajneeti: Path to Power

An offline, single-player Indian political strategy game. Lead an opposition party to victory in the Lok Sabha, govern as Prime Minister for five years, then fight for re-election. All parties and leaders are fictional.

## Play
- **Quickest:** open `dist/index.html` in any browser. It's one self-contained file with no internet needed.
- **Install on a phone:** host the `dist/` folder on any static host (GitHub Pages, Netlify), open it, and choose "Add to Home Screen". The service worker caches it for offline play.

Progress auto-saves in the browser.

## Game phases
1. **Campaign (12 weeks):** rallies, door-to-door drives, ads, fundraising, attacks, a 5-promise manifesto, and alliances with regional parties across 25 states and regions (543 seats).
2. **Counting day:** seat-by-seat first-past-the-post results.
3. **Hung parliament:** bargain with kingmakers using cabinet berths, state packages or the Deputy PM post.
4. **Governing (20 quarters):** annual Union Budget (taxes and spending), 20 bills through the Lok Sabha and Rajya Sabha, an independent RBI, credit ratings, coalition management, state elections, no-confidence motions, and crisis events.
5. **Re-election:** your approval in each state becomes your starting position, and broken promises cost trust.

## Develop
Source is in `src/` (`data.js` content, `events.js` event cards, `engine.js` rules/economy, `ui.js` interface). Open `src/index.html` directly while editing, then run `node build.js` to regenerate `dist/`.
