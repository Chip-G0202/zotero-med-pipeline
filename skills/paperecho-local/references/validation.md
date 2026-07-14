# Local Validation

## Targeted Tests

```powershell
node --test workflow/tests/local_pipeline.test.mjs
node --test workflow/tests/shared_literature_index.test.mjs
node --test workflow/tests/title_translation_generation.test.mjs
node --test workflow/tests/stage1_artifacts.test.mjs
node --test workflow/tests/spreadsheet_adapter_compat.test.mjs
```

## Acceptance Checks

- Real Local orchestration calls the real Stage1 entrypoint.
- Import, dedupe, classification, persistence, translation, and Stage4 export complete.
- Zotero readiness, backend factory, Desktop launcher, Stage2, and Stage3 poison counters are all zero.
- Repeating the same input reports `created=0` and does not call the translator again.
- Feedback consumption follows `1/0/1` across old/no-new/new-event runs; failed learning leaves the event pending.
- Atomic write failure preserves the formal file and leaves no current-run temp file.
- Local snapshots contain `translatedTitle` but no Zotero-only locator or metadata fields.
- XLSX English and translation columns are both populated and differ for the controlled English-only fixture.
