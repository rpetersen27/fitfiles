# fitfiles-cli

TypeScript project for analyzing cycling `.fit` files.

It now contains:

- a CLI build in `dist/`
- a static browser app that builds into `docs/` for GitHub Pages

## Metrics

Overall and per section:

- Complete duration
- Active duration
- Average HF
- Max HF
- Distance
- Average Speed
- Average Watt
- Normalized Power
- Max Watt

Per section:

- HF delta after 60 seconds
- Efficiency (`W/BPM`)
- HF drift (second half minus first half)
- Watt drift (second half minus first half)

For now, a section is a FIT `lap` message.

## Install

```bash
npm install
```

## CLI

Build and run:

```bash
npm run build:cli
node dist/cli.js ./path/to/activity.fit
```

Or after linking globally:

```bash
npm link
fit-analyze ./path/to/activity.fit
```

## Website

Run locally:

```bash
npm run dev
```

Production build:

```bash
npm run build:web
```

That writes the static site to `docs/`.

## GitHub Pages

This project can be hosted on GitHub Pages because the FIT file is parsed entirely in the browser.

To publish:

```bash
npm run build
```

Then push the repo and configure GitHub Pages to serve from:

- Branch: `main`
- Folder: `/docs`
