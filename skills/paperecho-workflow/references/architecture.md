# Architecture Reference

## Entry and path model

| Path | Entry | Shared work | Boundary-only work |
|---|---|---|---|
| Zotero Desktop | `workflow/tools/stage0/main.mjs::runZoteroLiteratureFilter`, `ZOTERO_BACKEND=cli` | Stage1-Stage5, identity, index, translation generation, export, housekeeping | Desktop launch/readiness, CLI and JS bridge transport |
| Zotero Web API | `workflow/tools/stage0/main.mjs::runZoteroLiteratureFilter`, `ZOTERO_BACKEND=web_api` | Same pipeline and contracts as Desktop | Web API v3 requests, versions, batching, backoff and rate limits |
| Standalone Local | `workflow/tools/local/main.mjs::runLocalPipeline` | Stage1 domain logic, identity/index, translation generation/cache, Stage4 mapping, Stage5, housekeeping | JSON/JSONL import, local persistence, feedback checkpoint, timings and exports |

Desktop and Web are not separate pipelines. They share Stage0 orchestration and differ at the Zotero backend transport. Local reuses shared domain services but is not a Zotero backend.

## Stage topology

```text
Desktop/Web: Stage0 -> Stage1 -> backend readiness -> Stage2 -> Stage3 -> Stage4 -> Stage5
Local:       Local entry -> Stage1 -> shared translation generation -> Stage4 -> Stage5
```

Stage5 is invoked only after a successful Stage4. Absence of a recipient produces a normal skip. Housekeeping creates the current run group and attempts retention cleanup before Stage1; failures are warnings and do not redefine the business result.

## Owners

- Stage orchestration: `workflow/tools/stage0/main.mjs`
- Local orchestration: `workflow/tools/local/main.mjs`
- Shared Stage owners: `workflow/tools/stage1/main.mjs`, `stage2/main.mjs`, `stage3/main.mjs`, `stage4/main.mjs`, `stage5/main.mjs`
- Zotero contract and adapters: `workflow/tools/lib/zotero_backend_contract.mjs`, `zotero_cli_backend.mjs`, `zotero_web_api_backend.mjs`
- Local adapter: `workflow/tools/local/local_import.mjs`, `local_repository.mjs`, `local_timing.mjs`
- Cross-path services: `literature_identity.mjs`, `zotero_library_index_store.mjs`, `title_translation_generation.mjs`, `title_translation_support.mjs`

## Dependency rules

- Shared stages depend on domain and contract-level fields, not Desktop process details or Web HTTP response fields.
- Backend-specific audit data may be carried in `backendDetails`; it must not become shared branching logic.
- Local must not construct a Zotero backend, start Desktop, call Stage2/Stage3, or persist Zotero-only locators.
- Translation generation is shared. Stage3 owns only Zotero translation metadata writeback and verification.
- Stage5 depends on Run Summary, formatter, overview, receipt, and SMTP modules; it must not import Zotero modules.
- Add path differences in the adapter that owns them. Never copy `stage0-5` into path-specific variants.

## Non-negotiable outcomes

- One canonical shared identity order and one shared physical literature index.
- New Zotero items route to one source and one grade collection, not root `文献池`.
- Runtime state is run-scoped; persistent user state and caches are never inferred to be disposable.
- Notifications and housekeeping may report failure, but neither rolls back successful Stage1-Stage4 artifacts.
