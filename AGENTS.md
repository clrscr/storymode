# Repository Guidelines

## Project Structure & Module Organization
This repository is currently minimal and does not expose a standard layout. If you add structure, keep it predictable and document it here. A typical layout is:

- `src/` — primary source code
- `tests/` or `__tests__/` — automated tests
- `assets/` or `public/` — static assets
- `scripts/` — automation and tooling

If your project uses a different structure, update this section with the exact directories and their purpose.

## Build, Test, and Development Commands
No build or test commands are defined yet. When you add tooling, list the exact commands here with a short description. Examples:

- `npm run dev` — start the local dev server
- `npm test` — run the test suite
- `make build` — produce production artifacts

## Coding Style & Naming Conventions
No formatting or linting rules are configured yet. When you introduce them, include:

- Indentation (e.g., 2 spaces for JS/TS, 4 spaces for Python)
- Naming patterns (e.g., `PascalCase` for components, `kebab-case` for files)
- Formatting tools (e.g., `prettier`, `eslint`, `ruff`, `black`) and how to run them

## Testing Guidelines
Tests are not set up yet. When adding tests, document:

- Test framework (e.g., `jest`, `vitest`, `pytest`)
- Test file naming (e.g., `*.test.ts`, `test_*.py`)
- How to run tests and optional coverage thresholds

## Commit & Pull Request Guidelines
No commit conventions are detectable in this repository. If you adopt a standard (e.g., Conventional Commits), document it here. For PRs, consider requiring:

- A clear summary of changes
- Linked issues or tickets when applicable
- Screenshots for UI changes
- Notes on testing performed

## Security & Configuration Tips
If the project uses secrets or environment configuration, add a `.env.example` and document required variables. Avoid committing secrets and prefer a secrets manager for production.
