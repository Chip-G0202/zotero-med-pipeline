# Public Release Checklist

- [ ] Only files under this directory are uploaded as the repository root.
- [ ] .env is not committed.
- [ ] .env.example contains placeholders only.
- [ ] config/ contains example RSS, PubMed/PMC, workflow-rule, and model settings only.
- [ ] generated outputs, logs, caches, local review workbooks, Zotero data files, and PDFs are excluded.
- [ ] Skills contains only med workflow skills and includes v1.4 update.
- [ ] Automation contains v1.4 update.
- [ ] Targeted validation has been run: JSON parse checks, Node syntax checks, import existence checks, and lightweight tests when available.

Suggested local scan before publishing:

```powershell
rg -n --hidden "api[_-]?key|token|secret|password|authorization|bearer|cookie|session|sk-" .
rg -n --hidden "<your-name>|<your-local-user-path>|<your-project-specific-terms>" .
```
