# EDEXO-Compare

Companion app for Elite Dangerous that predicts the exobiology on a planet from an FSS scan alone.

It reads your local journal folder, merges every `Journal.*.log` into one picture of the galaxy you
have visited, and — for any body with a biological signal — narrows the codex down to the species
that can actually live there, with payout ranges, first-footfall tracking, a system map and a
species encyclopedia.

Made by Bahuckel (CMDR FALrenica). Not affiliated with Frontier Developments.

## What it tells you

**Which body to fly to.** _Worth the trip?_ ranks every body in the system by expected value —
Σ chance × payout × first-footfall multiplier — alongside how many minutes on the ground it will
cost. Both timings are measured from your own journal, not guessed: approach and landing, and one
sampling run per genus.

**How likely each species is.** _Chance here_ is a calibrated probability, not a resemblance score.
It is built from how often a species has actually been recorded at this gravity, temperature,
pressure, planet class, atmosphere and host star, weighted by how common it is, and normalised
across the body's candidates. On bodies where every genus was sampled, rows it calls 90–100 % turn
up 97.8 % of the time.

**Which species, once you have mapped it.** After a DSS names the genus, the same posterior
renormalises inside that genus to say which of its species you are looking at.

**What you have not logged before.** A badge marks species new to your codex.

**Where it was wrong.** Every species you find that the app failed to offer is written to a local
miss log. That log is the reason recall went from 93.2 % to 97.1 %: it is read, not just recorded.

**On a second screen.** Open `?screen=triage` on a phone or tablet for a read-only triage view that
updates as you jump.

## Where the predictions come from

Two sources, and the app tells them apart.

The **codex rows** in `data/species/` say where a species should grow. A local corpus of ~39,000
real sightings says where it has grown. Where they disagree on a species the corpus has watched
enough times, **observation wins** — for host star, planet class, temperature, volcanism type,
gravity and atmosphere. Each of those six thresholds was swept against the app's own accuracy probe
before it shipped.

No number reaches the screen as a percentage unless the probe has calibrated it.

### The 5 % chance floor

Every candidate carries a **Chance here** figure — how often a species with this profile turns out to
actually be on a body like this one. It is the one percentage in the app that has been calibrated
against real outcomes: on bodies where every species is known, the 90-100 % band comes in at 97.8 %
and the 0-10 % band at 8.9 %.

Candidates below **5 %** are moved behind *show unlikely* rather than listed. A row at 2.7 % beside a
row at 100 % is the model telling you it has already decided, and putting them on the same list asks
you to do that arithmetic again.

The floor never empties a panel — if nothing clears it, the single best candidate stays — never
touches a row the model has no opinion about, and never argues with a species you have scanned on
foot yourself.

To change it, edit `PRESENCE_FLOOR_PCT` in [`src/server/snapshot.ts`](src/server/snapshot.ts) and
rebuild. Measured against 378 species the author later confirmed on foot, a 5 % floor moved exactly
one of them behind *show unlikely*.

## EDSM

The app can look a system up on [EDSM](https://www.edsm.net/) so a system already in the community
database can be triaged before you arrive.

This is **off by default**, and it stays off until you enter your own EDSM API key from
[edsm.net/en/settings/api](https://www.edsm.net/en/settings/api) in **Options**. Turning it on sends
the name of each system you jump to to EDSM, at most once per system — asked the moment the FSD
starts its countdown, so the answer is waiting when you drop out of witchspace rather than arriving
after you have already read an empty panel. The key is stored on your
machine in its own file beside your settings, never in the settings file, and **Forget key** deletes
it and switches auto-fetch off.

There is no telemetry, no analytics and no update check. See [site/privacy.html](site/privacy.html).

## Running it

The packaged app is a small launcher window; the app itself opens in your browser.

```
npm install
npm run dev            # Vite (5173) + API/WS (7111) + the marketing site
npm run electron:dev   # build, bundle and launch the Electron launcher
npm run dist:win       # portable .exe + CLI build into dist/
```

Point it at your journal folder from the launcher (**Journal folder**) if it is not in the default
`Saved Games\Frontier Developments\Elite Dangerous`.

### Ports and network modes

|                        | Binds            | Who can reach it                             |
| ---------------------- | ---------------- | -------------------------------------------- |
| `npm run start:client` | `127.0.0.1:7111` | this PC only                                 |
| `npm run start:server` | `0.0.0.0:7111`   | this PC **and every device on your network** |

Server mode exists so you can put the app on a second monitor, a tablet or a phone. It also means
the mutating endpoints (settings, exobiology reset, which system you are viewing) are reachable from
the LAN, so every non-loopback client must present an **access key**:

- the key is minted on first server-mode launch and stored beside your user settings
  (`%LOCALAPPDATA%\ED Exo Compare\edexo-compare-lan-key.txt`);
- the launcher's **Network settings → LAN** links already carry it as `?k=…`; open one on a device
  and it stays paired for a year via a cookie;
- requests from this PC never need it, so nothing about the local experience changes;
- delete the key file to un-pair every device.

Pass `--local` (or `--host 127.0.0.1`) to bind to this PC only, and no key is used at all.

## Development

```
npm test               # vitest over the pure logic (matching, payouts, layout, cache encoding)
npm run lint
npm run typecheck      # client + shared
npm run typecheck:server
npm run typecheck:tests
npm run format
```

### Measuring it

Accuracy is a measurement, not an opinion. The probes run against your own journal cache and the
species database, and print both scenarios — FSS-only and post-DSS — because a number for one of
them alone does not count.

```
npm run probe          # recall, ambiguity, precision, decidability, missing gate
npm run rank-probe     # mean rank, top-1, top-3, calibration buckets
npm run fixture        # regenerate the 20-body golden candidate fixture
```

`missing gate` is the one to watch: bodies where the app offers fewer candidates than the game
itself reports signals. It needs no ground truth to prove, and it should stay at zero.

### The feeder

The species profiles the model reads are built from a local corpus of Spansh exports hydrated
against EDSM. That corpus is a build input and is not in this repository.

```
npm run feeder -- status              # what the corpus holds vs what the app ships
npm run feeder -- import <file.csv>   # the one manual step
npm run feeder -- run [species...]    # hydrate, analyse, install
npm run feeder -- rebuild [species...] # rebuild profiles from packs on disk, no network
npm run feeder -- pack [species...]   # fold loose sample files into per-species archives
```

`EDEXO_PERF=1` turns on the server-side performance log — timers, counters and payload sizes
reported every 30 s. It is a no-op otherwise, so it stays compiled in permanently:
`npm run dev:perf` or `npm run start:client:perf`.

## Layout

```
src/server/     journal merge, species matching, the ranking model, HTTP + WS
src/client/     the React app, and the second screen
src/shared/     types and pure helpers used by both
src/feeder/     corpus → shipped species profiles
scripts/        the feeder CLI and the accuracy probes
data/species/   the species database, one folder per genus
public/         launcher and the transparent HUD overlays
electron/       launcher window
site/           the marketing/legal pages (separate Vite build)
tests/          vitest suites
docs/archive/   internal planning notes — not tracked, see .gitignore
```

## Credits

Built on four communities' work, none of them affiliated with this project:

- **[Spansh](https://spansh.co.uk)** — the reason it was started, and the corpus every prediction is
  measured against.
- **[EDSM](https://edsm.net)** — body records and system coordinates.
- **[Canonn Research Group](https://canonn.science)** — the published species conditions every gate
  in this app started from.
- **[ED-DSN](https://ed-dsn.net)** — the species photographs.

Full attribution in [NOTICE.md](NOTICE.md).

## Licence

MIT for the code and this project's own data — see [LICENSE](LICENSE), which sets out what the grant
does **not** cover.

If you use the code or the species data in something of your own, a credit and a link back —
"based on EDEXO-Compare by Bahuckel, https://bahuckel.com/projects/edexo-compare" — is appreciated.
The licence does not require it; this is a request, not a term.

The species photographs are **not** MIT licensed and are not this project's to sublicense: the game
artwork is Frontier's and the capture belongs to the commander who took it. They are here with
[ED-DSN](https://ed-dsn.net)'s agreement while replacements are photographed, and any rights holder
who would prefer theirs removed can ask and it will be, with no justification needed — see
[NOTICE.md](NOTICE.md).

Elite Dangerous, its artwork and game content remain the property of Frontier Developments; see
[site/terms.html](site/terms.html).
