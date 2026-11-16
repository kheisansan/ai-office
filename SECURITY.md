# Security

## Scope

AI Office is a **local** knowledge-management tool. The dashboard binds to `127.0.0.1` by default and has **no authentication**. Do not expose `office serve` to the internet.

## Reporting

If you find a vulnerability in this repository, open a private GitHub security advisory (preferred) or contact the repository owner. Please do not file public issues for exploitable bugs until a fix is available.

## Hard rules (harness)

- AI sessions write only under job `draft/` (never the real vault directly).
- Paths containing `OpenClaw` are refused by hooks and by `applyDraft`.
- Agents must not delete files.
- Answerer must not use Web search; citations are program-verified against candidates.
- Secrets and real vault contents stay outside git (`.env`, `config/settings.json`, `DATA_DIR`).

## Publish checklist

Run before making the repo public or sharing a clone:

```bash
npm run publish:scan
npm test
```

Confirm the scan reports **0** hits for secrets, personal vault paths, and real `settings.json` contents.
