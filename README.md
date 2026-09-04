# EDEXO-Compare

Companion app for Elite Dangerous that predicts the exobiology on a planet from an FSS scan alone.

It reads your local journal folder, merges every `Journal.*.log` into one picture of the galaxy you
have visited, and — for any body with a biological signal — narrows the codex down to the species
that can actually live there, with payout ranges, first-footfall tracking, a system map and a
species encyclopedia.

Made by Bahuckel (CMDR FALrenica). Not affiliated with Frontier Developments.

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

`EDEXO_PERF=1` turns on the server-side performance log — timers, counters and payload sizes
reported every 30 s. It is a no-op otherwise, so it stays compiled in permanently:
`npm run dev:perf` or `npm run start:client:perf`.

## Layout

```
src/server/     journal merge, species matching, exploration values, HTTP + WS
src/client/     the React app
src/shared/     types and pure helpers used by both
data/species/   the species database, one folder per genus
public/         launcher and the transparent HUD overlays
electron/       launcher window
site/           the marketing/legal pages (separate Vite build)
tests/          vitest suites
docs/archive/   internal planning notes — not tracked, see .gitignore
```

## Licence

MIT — see [LICENSE](LICENSE). Elite Dangerous, its artwork and game content remain the property of
Frontier Developments; see [site/terms.html](site/terms.html).
