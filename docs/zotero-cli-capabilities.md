# Zotero CLI Capability Matrix

> **Status**: Documented — CLI commands based on local code analysis; please verify against each CLI official README before production use
>
> **Last Updated**: 2026-07-05
>
> **Probe Script**: `workflow/tools/diagnostics/zotero_cli_probe.mjs`

## Overview

This document captures the verified capabilities of two Zotero CLI tools for the MCP replacement project.

**Tools Under Evaluation**:
1. **zotero-cli-cc** (`zot`) - SQLite reads + Web API writes
2. **cli-anything-zotero** (`zotero-cli`) - Local API + JS Bridge

## Capability Matrix

### Read Operations

| Operation | zotero-cli-cc | cli-anything-zotero | Notes |
|-----------|---------------|---------------------|-------|
| Search items | `zot search "query" --json` | `zotero-cli item find "query" --json` | |
| Read item details | `zot read ITEM_KEY --json` | `zotero-cli item get ITEM_KEY --json` | |
| List collections | `zot collections --json` | `zotero-cli collection tree` | |
| Collection items | `zot collections items COLL_KEY --json` | `zotero-cli collection items COLL_KEY` | |
| List tags | `zot tags list --json` | `zotero-cli tag list` | |
| Export BibTeX | `zot export ITEM_KEY` | `zotero-cli item export ITEM_KEY --format bibtex` | |
| PDF full text search | `?` | `zotero-cli item search-fulltext "query"` | Requires verification |
| PDF find | `?` | `zotero-cli item find-pdf ITEM_KEY` | Requires verification |

### Write Operations

| Operation | zotero-cli-cc | cli-anything-zotero | Risk Level |
|-----------|---------------|---------------------|------------|
| Create collection | `zot collections create NAME` | `zotero-cli collection create NAME` | Medium |
| Delete collection | `?` | `zotero-cli collection delete COLL_KEY` | High |
| Update metadata | `zot update ITEM_KEY --field k=v` | `zotero-cli item update ITEM_KEY --field k=v` | Medium |
| Update shortTitle | `?` | `?` | Needs verification |
| Add tag | `zot tags add ITEM_KEY TAG` | `zotero-cli item tag ITEM_KEY --add TAG` | Low |
| Remove tag | `zot tags remove ITEM_KEY TAG` | `zotero-cli item tag ITEM_KEY --remove TAG` | Low |
| Add to collection | `zot collections add-item COLL_KEY ITEM_KEY` | `zotero-cli item add-to-collection ITEM_KEY COLL_KEY` | **High** (experimental) |
| Remove from collection | `zot collections remove-item COLL_KEY ITEM_KEY` | `zotero-cli collection remove-item COLL_KEY ITEM_KEY` | **High** |
| Attach PDF | `?` | `zotero-cli item attach ITEM_KEY ./file.pdf` | Medium |
| Import by DOI | `zot add --doi "DOI"` | `zotero-cli import doi "DOI"` | Low |

### Health & Diagnostics

| Operation | zotero-cli-cc | cli-anything-zotero | Notes |
|-----------|---------------|---------------------|-------|
| Ping | `zot app ping` | `zotero-cli app ping` | |
| Version | `zot app version` | `zotero-cli app version` | |
| Plugin status | N/A | `zotero-cli app plugin-status` | |
| Enable local API | N/A | `zotero-cli app enable-local-api` | |

## JSON Output Format

### zotero-cli-cc

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "request_id": "...",
    "cli_version": "0.4.3"
  }
}
```

### cli-anything-zotero

```json
// Varies by command - needs verification
// Some commands return array, some return object
```

## Error Handling

### Exit Codes

| Code | Meaning | zotero-cli-cc | cli-anything-zotero |
|------|---------|---------------|---------------------|
| 0 | Success | ✅ | ✅ |
| 1 | General error | ✅ | ✅ |
| 2 | Partial failure | ? | ? |

### stderr Behavior

- Both tools write errors to stderr
- JSON envelope includes error details on failure

## Collection Write Strategy

### CRITICAL: Verify After Write

Collection mutations (add/remove items) are **high-risk** operations. The following strategy is **mandatory**:

```
1. Execute add/remove operation
2. Verify by re-reading collection items
3. If verification fails:
   - Log failure to writeback_failures/report
   - Do NOT abort entire pipeline
   - Continue with next item
```

### Recommended Implementation

```javascript
async function safeAddToCollection(adapter, itemKey, collectionKey) {
  // 1. Execute
  await adapter.addItemToCollection(itemKey, collectionKey);

  // 2. Verify
  const items = await adapter.getCollectionItems(collectionKey);
  const verified = items.some(item => item.key === itemKey);

  if (!verified) {
    throw new Error(`Verification failed: ${itemKey} not in ${collectionKey}`);
  }

  return true;
}
```

### Move Strategy

**Do NOT use single move command.** Instead:

```
1. Add to target collection + verify
2. Remove from source collection + verify
```

## Desktop-Free Mode

### zotero-cli-cc

- ✅ SQLite reads work without desktop
- ✅ Web API writes work without desktop
- ⚠️ Requires Zotero account + API Key
- ❌ No PDF full text search (requires desktop)

### cli-anything-zotero

- ❌ Requires desktop running
- ❌ Local API needs localhost:23119
- ❌ JS Bridge needs desktop plugin
