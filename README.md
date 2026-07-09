# fitfiles-cli

Small Node.js CLI for analyzing cycling `.fit` files.

The CLI is now written in TypeScript and compiled to `dist/`.

## What it prints

- Complete duration
- Active duration
- Average HF
- Max HF
- Distance
- Average Speed
- Average Watt
- Max Watt

It prints these once for the full activity and then once per section.

For the first version, a section is defined as a FIT `lap` message. That matches how most cycling head units store manual or interval splits.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
node dist/cli.js ./path/to/activity.fit
```

Or after linking globally:

```bash
npm link
fit-analyze ./path/to/activity.fit
```
