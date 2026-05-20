# Development

Local development and manual testing notes. For the full script list see
[`AGENTS.md`](AGENTS.md).

## Setup

```powershell
npm install
```

## Common commands

| Command         | Purpose                                          |
| --------------- | ------------------------------------------------ |
| `npm run dev`   | Watch-mode build (rebuilds on change)            |
| `npm run build` | Typecheck + production bundle (`main.js`)        |
| `npm test`      | Run the Jest test suite                          |
| `npm run lint`  | ESLint check on `src/`                           |

A build writes `main.js` and `styles.css` into the repository root
(`manifest.json` is committed and only changes on a version bump).

## Testing in an Obsidian vault

This repository is intentionally **not** placed inside an Obsidian vault, so
the build output has to be copied into a vault's plugin folder to test it.
Keeping the two separate also leaves the installed-plugin folder free for
checking the [BRAT](https://github.com/TfTHacker/obsidian42-brat) update flow
independently.

A plugin folder needs three files: `main.js`, `manifest.json`, `styles.css`.

### Build and copy

```powershell
# 1. Build
npm run build

# 2. Copy into your vault's plugin folder (adjust the path)
$dst = "C:\Users\remus\Documents\Obsidian\ResearchKelan\.obsidian\plugins\tasks-map-jrxing"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item main.js, manifest.json, styles.css $dst -Force
```

### Reload the plugin

Copying the files is **not** enough — Obsidian keeps the old code in memory
until the plugin is reloaded. After copying, do one of:

- **Settings → Community plugins** → toggle **Tasks Map** off, then on; or
- Command palette → **Reload app without saving**.

To confirm the reload picked up the new build, open the developer console
(`Ctrl+Shift+I`) and check for plugin logs / the absence of stale behavior.
