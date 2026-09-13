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

CI runs, in order:

```
uv run ruff check app/ tests/
uv run ruff format --check app/ tests/
PYTHONPATH=. uv run pytest tests/ -v
```

On a Windows host with no Python deps, run the same inside the container image
(`rtfm-ev-local:latest`), worktree bind-mounted to `/work`:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "/$(pwd)://work" -w "//work" \
  -e UV_PROJECT_ENVIRONMENT=/app/.venv rtfm-ev-local:latest bash -lc "\
  uv sync --frozen --group dev && \
  /app/.venv/bin/ruff check app/ tests/ && \
  /app/.venv/bin/ruff format --check app/ tests/ && \
  PYTHONPATH=/work /app/.venv/bin/pytest tests/ -q"
```

Notes: `PYTHONPATH=/work` is required (else `No module named app`). Do not pass
`-p no:xdist` (pyproject bakes xdist addopts). Auto-fix import order with
`ruff check --fix`; ruff format issues with `ruff format`.

## Frontend (`frontend-checks`)

CI runs:

```
npm run lint
npm run format:check
npm run test:run
npm run build
```

Locally (after `npm ci` once in the worktree):

```bash
cd frontend
npm run lint
npm run format:check   # prettier - SEPARATE from lint
npm run test:run       # includes the i18n parity test
npm run build          # tsc typecheck + vite build
```

Fix prettier with `npx prettier --write <files>` (only the files you changed).

## Quick gate before pushing

Backend changed -> run the backend block. Frontend changed -> run the frontend
block. Both changed -> run both. Only push once every command above is green.
