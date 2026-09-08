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
- **Uber receipts, not retyping.** Drop in the receipt PDFs, paste the emails or
  upload Uber's `trips_data.csv`, and the rides log themselves — fares, stops
  and dates included.
- **Uneven groups are fine.** Each ride splits only among whoever was actually in
  the car, and the person who paid doesn't have to be one of them.
- **Cent-exact.** Fares that don't divide evenly hand the leftover pennies to the
  first riders, so shares always add up to the fare.
- **Two phones, one trip.** Send someone your export and theirs merges into
  yours: you both keep every ride you logged, and nobody's copy wins.

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

### Sharing a trip

Importing doesn't replace what you have, it folds the file into it, which is
enough for a group to share a trip without a server in the middle. Everyone logs
their own rides; someone exports and sends the file round; each person imports
it and ends up with the lot. Import the same file twice and the second time
changes nothing.

It isn't live — you get what was in the file when it was sent, not what the
other phone is doing right now — but nothing is ever lost in the exchange, which
is the part that would otherwise go wrong.

### Importing from Uber

Under **Rides**, "Import from Uber" reads your receipts and turns the ones you
pick into rides. Three ways in, all of which stay on your machine:

- **Upload the receipt PDFs.** Download a trip's receipt from the Uber app or
  your email and pick it — as many at once as you like, one file per ride. This
  is the one that works on the Monday after the trip.
- **Paste the receipt emails.** Open each one, select all, paste. Several at
  once is fine, and the HTML that comes with a copy/paste is fine too.
- **Upload `trips_data.csv`.** Ask Uber for your data at
  [their privacy centre](https://myprivacy.uber.com/privacy/exploreyourdata/download);
  the export lands in your inbox a day or two later and covers everything.

Files are read one by one, so a boarding pass caught up in the selection is
named and set aside rather than sinking the rest, and a ride that arrives twice
— its own PDF and a row in the CSV — is only logged once.

Everything it finds goes in a list you tick through before anything is saved,
with cancelled and free rides left out and the reason shown. They're all logged
to one payer, because they're one Uber account's receipts, and split among the
riders you choose; where a particular ride had a different set of people in the
car, **edit** it afterwards. Uploading the same export twice is safe — rides
already imported come back unticked, so you only add what's new.

There's no "connect your Uber account" button, and it isn't for want of trying.
Uber's trip-history API doesn't return fares — it gives times, distance and
city, and stops there — so the one number a fare splitter needs isn't in it. The
receipts are the only place that number exists, and reading them needs no
account, no server and no API key.

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

## How merging works

Every rider and ride carries when it was made and when it was last touched, and
deleting one leaves a note of the deletion behind rather than removing every
trace. That's what lets two copies be folded together:

- Records are matched by id, so anything only one side has is kept.
- Two copies of the same record: the later edit wins, whole. Nobody edits half a
  ride, so there's nothing to gain from merging field by field.
- A deletion beats an edit, however recent. Otherwise a phone that hadn't
  synced yet would keep putting back the ride you deleted.
- Unless the deletion has been overtaken: a rider you removed who turns up in
  someone else's ride comes back, because a fare split among someone who isn't
  on the trip doesn't add up.

Merging is commutative — it doesn't matter who imports whose file, or in what
order — which is what makes passing one file around a group safe. The clock is
each phone's own, so two people editing the same ride in the same moment is
resolved arbitrarily but identically on both, rather than by losing one.

## Project layout

```
src/core/     the math and the data model, no DOM in sight
  money.ts      parsing and formatting amounts in cents
  split.ts      dividing a fare among riders
  settle.ts     balances, and who pays whom
  trips.ts      trips, people, rides, validation
  merge.ts      folding two copies of the data back together
  uber.ts       reading receipts, and turning them into rides
  storage.ts    saving, loading, import and export
src/ui/       Preact components
  App.tsx       the error banner, and which view the route is showing
  store.ts      the one copy of the data, saved on every change
  router.ts     hash routes, so every trip has its own URL
  Dashboard.tsx the list of trips
  TripPage.tsx  one trip: riders, rides, settle up
  RideForm.tsx  adding and editing a ride
  UberImport.tsx  reviewing parsed receipts before they become rides
  pdf.ts        pulling the text back out of a receipt PDF
tests/        vitest suites for core/, the router, and the components
```

Reading a PDF needs [pdf.js](https://mozilla.github.io/pdf.js/), which is
bigger than everything else here put together, so it's split into its own chunk
and fetched the first time someone picks a PDF — the app still starts on about
16kB of JavaScript, and a browser that never opens a receipt never downloads it.

TypeScript throughout, Preact for the views, Vite to build. `src/core` is plain
TypeScript with no browser APIs, which is what makes it straightforward to test
— and easy to reuse if this ever grows a CLI or a backend.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and
`npm run typecheck` before opening one, and add a test alongside any change to
`src/core`.

## License

MIT — see [LICENSE](LICENSE).
