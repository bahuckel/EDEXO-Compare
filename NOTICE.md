# Notice, credits and third-party material

EDEXO-Compare is MIT licensed. **The MIT licence covers the source code and the data this project
produced itself. It does not cover the species photographs, and it does not cover Elite Dangerous
game content.** See "Species photographs" below, which is the part still being resolved.

---

## Standing on other people's work

This project would not exist without four communities, none of which are affiliated with it and none
of which have endorsed it.

### Spansh — [spansh.co.uk](https://spansh.co.uk)

The reason this project was started. Spansh's exobiology search showed that "which species can live
on this body" is a question data can answer, and its route exports are the corpus every prediction in
this app is measured against — 47,983 confirmed sightings across 13,789 bodies at the time of
writing. Every calibration figure quoted in the README traces back to a Spansh export.

### EDSM — [edsm.net](https://edsm.net)

Body records: gravity, temperature, pressure, atmosphere, volcanism and orbital geometry for the
bodies in the corpus, plus the system coordinates that place them. Queried through the public API at
one request per 1.5 s and cached, so a re-run costs EDSM nothing.

### Canonn Research Group — [canonn.science](https://canonn.science)

The community's accumulated knowledge of where exobiology grows: the genus and species conditions,
the gravity and temperature limits, the atmosphere and volcanism requirements. Where this app's own
observations disagree with the published conditions, the observation wins — but the published
conditions are where every gate started, and being able to disagree with something is a debt to
whoever wrote it down first.

### ED-DSN — [ed-dsn.net](https://ed-dsn.net)

The species photographs. Commanders flew to these places, landed, and photographed the organism, and
that is not a small thing to have done ninety-seven times.

The colour-variant tables in `data/species/eddsn-colour-variants.json` were transcribed from the same
site — which species reads its colour off the parent star and which off a material on the body, and
what each key maps to. Community knowledge rather than a proprietary dataset, and checked against
this commander's own journals before it was wired in, but ED-DSN is where it was read from and typing
several hundred rows by hand was the alternative.

Credited by link to the network rather than by commander name, at ED-DSN's request and ours: the
photographs were taken on an expedition years ago and a significant number of those commanders can no
longer be reached, so naming some and not others would be worse than naming none.

---

## Species photographs

`data/species/<genus>/<genus>_photos/` holds 97 images of Elite Dangerous exobiology (each also
present as a cropped card and thumbnail, so 291 files), sourced from the ED-DSN community. They are
**not covered by this project's MIT licence** and are not this project's to sublicense.
Bahuckel / CMDR Falrenica (me, the owner of the project) - Is working on sourcing his own photographs to replace the images from ED-DSN, that are there mainly as placeholders. 

Two rights sit in each image and neither belongs to this project:

- the game artwork, which is Frontier Developments';
- the capture itself, which belongs to the commander who took it.

### What has and has not been agreed

ED-DSN's owner was asked directly, told what the images are used for, and **agreed that this project
may keep them for now**, until replacements exist. That is the agreement of the network that
curates them, and it is what this project has.

It is deliberately not described as a licence. The photographs were taken on an expedition years ago
and a significant number of those commanders are no longer reachable, so most of the individual
authors have neither granted nor refused anything — and nobody else can grant it for them. The images
are therefore here with the curator's agreement and without the authors', which is stated plainly
rather than papered over.

### They are being replaced

ED-DSN and this project are organising an expedition to photograph each species afresh, with
commanders who agree up front that their images may be used here. Those images will replace the ones
in this folder. Until then these stand in.

**If any rights holder would prefer their image not be here, it will be removed on request** — open
an issue or contact the maintainer, and no justification is needed.

## Elite Dangerous

Elite Dangerous is © Frontier Developments plc. Elite Dangerous, its logos, artwork, game content and
the names of the species catalogued here are Frontier's property, used here as fan work under
Frontier's fan-content terms. This project is not affiliated with, endorsed by, or connected to
Frontier Developments.

## Galaxy region data

`data/exomastery/region-map.json` is from
[EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap) by Ben Peddell,
redistributed under its MIT licence — full text in `data/exomastery/region-map.LICENSE.txt`.

## Runtime dependencies

`express` (MIT) and `ws` (MIT). Everything else in `package.json` is a development dependency and is
not redistributed with the application.
