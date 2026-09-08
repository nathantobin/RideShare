# Ride Share

Split taxi fares on a group trip and see who owes whom.

**[Open the app →](https://nathantobin.github.io/RideShare/)**

Someone always pays the driver, and it's never the same someone twice. Log each
ride as it happens and Ride Share works out the shortest set of payments that
squares everyone up at the end of the trip — four Venmos for a five-person
weekend, not fifteen.

- **No account, no install.** It's a web page. Open it on your phone in the back
  of the cab.
- **A dashboard of your trips.** Every trip shows its riders, rides, total and
  whether anyone still owes anything, and opens with one tap.
- **Trips keep rides separate.** Charleston in June doesn't get mixed up with
  Austin in March, and a new trip can copy the same crew across.
- **From / To stops.** Leave the description blank and a ride names itself
  "Shem's Creek → Home".
- **Uneven groups are fine.** Each ride splits only among whoever was actually in
  the car, and the person who paid doesn't have to be one of them.
- **Cent-exact.** Fares that don't divide evenly hand the leftover pennies to the
  first riders, so shares always add up to the fare.

## Using it

The home screen lists your trips, with buttons to create, rename and delete
them. Opening one gives you its own page, which walks top to bottom: **riders →
rides → settle up**. Click any step's header to reopen it later, and "All trips"
to go back. Each trip has its own URL, so the browser's back button and a
bookmark both work.

Your trips are saved in your own browser and never leave your device. That also
means they're tied to that browser, so use **Export JSON** to back a trip up or
move it to your laptop, and **Import JSON** to load it there. `sample-trip.json`
in this repo is a small example you can import to see how it looks.

## Running it locally

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the built `dist/` |

Pushing to `main` runs the tests and deploys to GitHub Pages.

## How the math works

Money is tracked in whole cents, never floats, so nothing drifts. Each ride
splits evenly among its riders; when the fare doesn't divide evenly the leftover
pennies go to the first riders in the list, which keeps every ride's shares
adding up to exactly the fare.

Settling up sorts everyone by what they're owed, then repeatedly matches the
biggest debtor to the biggest creditor. Finding the true minimum number of
payments is NP-hard, but this never needs more than one payment per person and
in practice lands on the answer you'd work out by hand.

For a split that isn't even — someone got out halfway — log it as two rides with
different rider lists.

## Project layout

```
src/core/     the math and the data model, no DOM in sight
  money.ts      parsing and formatting amounts in cents
  split.ts      dividing a fare among riders
  settle.ts     balances, and who pays whom
  trips.ts      trips, people, rides, validation
  storage.ts    saving, loading, import and export
src/ui/
  app.ts        the shell: state, persistence, and which view is showing
  router.ts     hash routes, so every trip has its own URL
  dashboard.ts  the list of trips
  trip-view.ts  one trip: riders, rides, settle up
tests/        vitest suites covering core/ and the router
```

`src/core` is plain TypeScript with no browser APIs, which is what makes it
straightforward to test — and easy to reuse if this ever grows a CLI or a
backend.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and
`npm run typecheck` before opening one, and add a test alongside any change to
`src/core`.

## License

MIT — see [LICENSE](LICENSE).
