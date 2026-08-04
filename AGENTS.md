# Repository instructions

## Documentation lifecycle

- Keep README content evergreen: project purpose, supported architecture, normal setup, standard development, and repeatable operations.
- Do not put one-time migrations, temporary rollout ordering, upgrade catch-up steps, incident remediation, or obsolete compatibility instructions in the README.
- Keep `docs/CHANGELOG.md` as an index and record transient operational guidance in `docs/changelog/YYYY-MM.md`.
- Use exactly one `YYYY-MM-DD` entry per day. Compact all changes from the same day into that entry, including what changed, why it changed, affected deployments or data, required action, verification, rollback or recovery notes when relevant, and current status.
- Update the existing daily entry when its status changes. Preserve the historical entry instead of leaving stale instructions in the README.
- A README may link to the change log but must not duplicate its transient procedures.
