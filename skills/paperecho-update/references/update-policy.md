# PaperEcho update policy

## Trust and version selection

The only deployment source is `https://github.com/Chip-G0202/PaperEcho.git`. Resolve annotated tags to their peeled commits and accept only `vMAJOR.MINOR` or `vMAJOR.MINOR.PATCH`. Compare numeric components, exclude prereleases and branches, and never follow `main`. Equivalent spellings such as `v2.2` and `v2.2.0` are valid only when they resolve to the same commit; otherwise stop. Never downgrade automatically.

## Installation discovery

Each invocation checks an explicit `--install-dir`, then cwd and at most three parents, then bounded Documents locations. Windows uses `USERPROFILE/Documents`, `USERPROFILE/OneDrive/Documents`, and existing `OneDrive*` environment roots. macOS uses `HOME/Documents` and the existing iCloud Documents folder. Search depth is at most three. A candidate needs multiple PaperEcho structural markers; an incorrect Git origin is rejected, and multiple high-confidence candidates require an explicit path.

## Managed and persistent data

The target release's machine-readable contract owns the boundary. Managed program files use OLD/LOCAL/NEW comparison. A changed managed file, a collision with a target addition, or a changed target deletion blocks the update. `config/` is persistent except for contract-listed examples and documentation. Secrets, real config, state, watermarks, ledgers, receipts, leases, artifacts, outputs, workbooks, logs, updater state, and rollback snapshots are never replaced or deleted.

## Transaction

Check is the default and performs no live writes. Apply requires `--apply`, a supported target contract, compatible state/config schemas, no active run, and an atomically acquired updater lock. The target is cloned to updater-owned staging and its tag, peeled commit, origin, contract, dependencies, and syntax are verified before any live mutation. Immediately before deployment, version, target, active-run, and managed hashes are checked again.

Git installations require the official origin, an exact stable current tag, clean managed files, and fast-forward history; developer/custom checkouts are not overwritten. Non-Git installations require trusted updater state and its managed manifest. Replacements are same-directory temporary writes plus rename. Dependency installation occurs only when `package-lock.json` changes and uses `npm ci`, never `npm update` or `npm audit fix`.

Before mutation the updater records a minimal manifest-backed rollback snapshot of affected managed and tracked persistent files. Any critical failure restores changed/deleted/added files and verifies the old version plus persistent hashes. Only verified recovery may be reported as restored. Keep at most two updater-owned snapshots. No arbitrary downgrade or schema migration is performed.
