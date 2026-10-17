# Pre-push CI checks (run these before every push)

CI (`.github/workflows/all-quality.yml`) has two jobs that block a PR. They fail
independently of each other, and several steps fail FAST (ruff, prettier) before
tests even run. Passing pytest locally is NOT enough. Run the CI-equivalent
checks below before pushing, or the PR goes red on things that were avoidable.

Recurring offenders (seen repeatedly):

- Backend `ruff check` I001 import-order after adding imports.
- Backend `ruff check` B905: `zip(a, b)` must be `zip(a, b, strict=...)` (this
  repo enables B905). Use `strict=False` unless you want the length check.
- Frontend `format:check` (prettier) is a SEPARATE gate from `lint` (eslint). A
  file can pass eslint and still fail prettier. See the note in the repo about
  running prettier separately.
- Frontend i18n parity test fails when a new `t()` key is missing from any of
  `en.json` / `nl.json` / `de.json`.

## Backend (`backend-checks`)

CI runs FOUR steps, in order (`.github/workflows/all-quality.yml`):

```
uv run ruff check app/ tests/          # Backend lint
uv run ruff format --check app/ tests/ # Backend format check
uv run pyright app/                     # Backend typecheck (easy to forget)
PYTHONPATH=. uv run pytest tests/ -v    # Backend tests
```

The `pyright app/` step is a real gate and NOT covered by pytest. A common miss:
assigning a plain `str` where a `Literal[...]` is expected (e.g. a dataclass
field feeding a Pydantic model whose field is `Literal[...]`). Type the source
field as the same `Literal` so it flows through.

On a Windows host with no Python deps, run the same inside the container image
(`rtfm-ev-local:latest`), worktree bind-mounted to `/work`:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "/$(pwd)://work" -w "//work" \
  -e UV_PROJECT_ENVIRONMENT=/app/.venv rtfm-ev-local:latest bash -lc "\
  apt-get update -qq && apt-get install -y -qq libatomic1 >/dev/null 2>&1; \
  uv sync --dev && \
  uv run ruff check app/ tests/ && \
  uv run ruff format --check app/ tests/ && \
  uv run pyright app/ && \
  PYTHONPATH=/work uv run pytest tests/ -q"
```

Notes: `PYTHONPATH=/work` is required for pytest (else `No module named app`).
Do not pass `-p no:xdist` (pyproject bakes xdist addopts). `pyright`'s bundled
node needs `libatomic1`, which the runtime image lacks, so install it first (the
one-liner above). Auto-fix import order with `ruff check --fix`; ruff format
issues with `ruff format`.

## Frontend (`frontend-checks`)

CI runs:

```
npm run lint
npm run format:check
npm run test:run
npm run build
```

Locally (after `npm ci` once in the worktree, or the shared dependency folder
below):

```bash
cd frontend
npm run lint
npm run format:check   # prettier - SEPARATE from lint
npm run test:run       # includes the i18n parity test
npm run build          # tsc typecheck + vite build
```

Fix prettier with `npx prettier --write <files>` (only the files you changed).

### Shared dependency folder (Windows, instead of `npm ci` / `uv sync` per worktree)

```powershell
pwsh scripts/setup/link_shared_deps.ps1          # node + python
pwsh scripts/setup/link_shared_deps.ps1 -Only node
```

Installs live once in `RTFM-EV-deps/` next to the main checkout (override with
`-Store` or `$env:RTFM_DEPS_STORE`), one install per lockfile version:
`node/<key>/node_modules` (key: `frontend/package-lock.json`, `frontend/.npmrc`,
Node major) and `python/<key>/.venv` (key: `uv.lock`, the system Python uv
picks). The script links the worktree's `frontend/node_modules` and `.venv` to
the matching install as directory junctions, and installs it first when it does
not exist yet. A branch that changes a lockfile gets its own key and install, so
nothing goes stale; run the script again after a lockfile change.

- A real `node_modules` / `.venv` in the worktree is left alone unless you pass
  `-Force`. `-DryRun` shows what would happen.
- `-List` shows the installs and which worktrees link to each; `-Prune` deletes
  the ones no worktree links to (`-Prune -DryRun` first).
- Never run `npm install <pkg>`, `npm ci` or `uv add` in a linked worktree: it
  writes into the install other worktrees share. Change the manifest and
  lockfile, then re-run the script. `uv run` also syncs the venv to the
  worktree's `uv.lock`, so after a `uv.lock` change run the script before the
  next `uv run` (or use `uv run --frozen`).
- To drop a link, delete only the junction:
  `[IO.Directory]::Delete("frontend/node_modules", $false)`. Never
  `Remove-Item -Recurse` through a junction.
- Vite's cache (`node_modules/.vite`) is shared too, so two dev servers on the
  same install at once can disturb each other's dependency prebundle.
- `vite.config.ts` and `vitest.config.ts` allow the link's real path in
  `server.fs.allow`, which the maplibre `?worker&url` import needs.

## Docs site (not a PR gate)

`.github/workflows/pages.yml` only runs on `main` (and by hand) and deploys the
GitHub Pages site. To preview a docs change locally, stage it and build it with
the same image the workflow uses:

```bash
python3 scripts/build/stage_pages_site.py --out _pages_build/src
MSYS_NO_PATHCONV=1 docker run --rm -v "/$(pwd)/_pages_build://github/workspace" \
  -e GITHUB_WORKSPACE=/github/workspace -e INPUT_SOURCE=src -e INPUT_DESTINATION=site \
  ghcr.io/actions/jekyll-build-pages:v1.0.13
python3 -m http.server 8765 -d _pages_build/site
```

## Quick gate before pushing

Backend changed -> run the backend block. Frontend changed -> run the frontend
block. Both changed -> run both. Only push once every command above is green.
