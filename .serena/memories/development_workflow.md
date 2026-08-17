# Development workflow memory

## Branch policy

- `main` is integration-only.
- Work from a typed topic branch such as `feature/<kebab-case>` or `fix/<kebab-case>`.
- Run `pnpm check` before integration.
- Push the topic branch and confirm CI when remote validation is needed.
- Merge locally into `main` with `git merge --no-ff` and a `merge: ...` message.
- Do not create a pull request unless the user explicitly changes the solo-project policy.

## Commit policy

Use one of the configured prefixes:

- `feat`: new functionality
- `fix`: bug fix
- `build`: build or dependency change
- `chore`: maintenance
- `ci`: CI configuration
- `docs`: documentation
- `style`: formatting or code style only
- `refactor`: behavior-preserving refactor
- `test`: test change
- `perf`: performance improvement

Keep commits atomic and write the subject in imperative English, following the established LOOFIO
history. Integration commits use `merge: <completed capability>`.

## Notion capture policy

- Project Home: `2026 / 2026 3분기 / WHICH`
- Create or move the matching Task record to `Doing` when meaningful work begins.
- After completion, write purpose, plain-language explanation, actual changes, decisions and rejected
  alternatives, validation, remaining risks, and next work.
- Add Branch, Commit, GitHub, and Related Decisions when available.
- Mark a Task `Done` only after the requested outcome and relevant verification are complete.
- Keep Notion explanatory; keep code and exact implementation history in GitHub.
- Detailed destination URLs and fields are in `docs/development/notion-workflow.md`.
