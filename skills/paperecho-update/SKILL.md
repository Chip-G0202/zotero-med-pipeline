---
name: paperecho-update
description: Use when checking whether PaperEcho is current, checking whether an update is safe, updating or upgrading PaperEcho, or safely deploying the latest stable PaperEcho release from the official Chip-G0202/PaperEcho GitHub repository. Do not use for literature retrieval, Zotero operations, weekly runs, resume, or grading.
---

# PaperEcho Update

Use the deterministic updater; do not improvise file copying or Git transitions.

- For “有更新吗 / 是否最新版 / 能否安全更新”, run `node skills/paperecho-update/scripts/update.mjs --check --json`.
- For an explicit update request, run the same check first. Run `node skills/paperecho-update/scripts/update.mjs --apply --json` only when `safeToApply` is true.
- Add `--install-dir <path>` when detection reports multiple candidates. Never choose one automatically.
- Treat network, active-run, update-lock, managed-file conflict, unsupported contract/schema, and developer-checkout results as blockers. Do not modify the live installation.
- Never accept an alternate repository URL, follow `main`, downgrade, install Git, kill PaperEcho, or expose configuration contents.

Read [update-policy.md](references/update-policy.md) for the safety model and [update-contract.json](references/update-contract.json) for the release-owned managed/persistent boundary.
