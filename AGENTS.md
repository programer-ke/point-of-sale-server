# Repository instructions

## Documentation lifecycle

- Keep README content evergreen: project purpose, supported architecture, normal setup, standard development, and repeatable operations.
- Do not put one-time migrations, temporary rollout ordering, upgrade catch-up steps, incident remediation, or obsolete compatibility instructions in the README.
- Keep `docs/CHANGELOG.md` as an index and record transient operational guidance in `docs/changelog/YYYY-MM.md`.
- Use exactly one `YYYY-MM-DD` entry per day. Compact all changes from the same day into that entry, including what changed, why it changed, affected deployments or data, required action, verification, rollback or recovery notes when relevant, and current status.
- Update the existing daily entry when its status changes. Preserve the historical entry instead of leaving stale instructions in the README.
- A README may link to the change log but must not duplicate its transient procedures.

## Customer help lifecycle

- The public customer help source lives in the client repository at \`src/content/help.ts\`. Review it whenever a change affects customer-visible workflows, navigation, labels, permissions, validation, business rules, pricing, billing, support details, or failure behaviour.
- Update affected guides in the same work. Add or retire a guide when a customer journey is introduced or removed, and keep public routes plus the sitemap consistent with the content registry.
- Write for customers in plain language and define retail, accounting, tax, or supply-chain terminology when it first appears. Do not expose platform-administration procedures, tenant internals, secrets, or security-sensitive implementation details.
- Screenshots are optional and must never replace complete written instructions.
- For internal-only changes, explicitly record in the change summary that the help center was reviewed and no customer documentation update was required.
