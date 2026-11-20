# Coordination board

No prior coordination board existed when this session started (2026-11-20 UTC). The repository contained only `README.md`, so there were no active claims or shared site/data outputs to avoid.

| Task | Status | Owner / session ID | File scope |
|---|---|---|---|
| Single-session integration: Kalshi demo dashboard, source-linked findings, flagged-review page, verification, and GitHub Pages setup | in progress | `98f1c044` (current Arena branch `arena/98f1c044-trade1`; session ID not separately exposed) | Entire repository: `COORDINATION.md`, `README.md`, application, assets, tests, and `.github/workflows/` |

## Work log

- 2026-11-20: Read the coordination board before starting. It did not exist. Claimed the whole-repository integration task because the repository has a single-file baseline and no other claims were present. Work will remain on the current Arena-managed branch; no secondary branch or worktree will be created.
- Planned verification boundary: use Kalshi's official demo REST/WebSocket API and official developer documentation. Show values only when the official API supplies them; omit unsupported values and label runtime/API failures or assumptions for review. Live account order placement will be demo-only and require credentials configured outside the site; without credentials, the built-in simulator will remain local and clearly labeled as simulated.
