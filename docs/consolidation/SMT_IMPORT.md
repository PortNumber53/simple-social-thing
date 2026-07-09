# Social Manager Thing Consolidation

Simple Social Thing is now the implementation base for **Social Manager Thing** (`SMT`). The original SMT scaffold is preserved at `/home/grimlock/work/social-manager-scaffold`; this repo now carries the active implementation.

## Direction

- Keep this repo's React + Cloudflare Worker + Go/Postgres implementation as the working base.
- Import SMT product naming, Jira identity, and MVP scope.
- Treat Xata/Worker-only architecture from the old scaffold as a future architecture option, not an immediate rewrite requirement.

## Product focus

The primary MVP flow is Instagram Business Account content scheduling:

1. Authenticate user.
2. Connect Meta/Facebook and discover Instagram Business account.
3. Create drafts/scheduled posts.
4. Publish via Instagram Graph API.
5. Track `SCHEDULED`, `PUBLISHED`, and `FAILED` statuses.
6. Enforce tier limits: Free 1/day, Standard 10/day, Pro up to Meta rate limits.

## Source artifacts

- Imported PRD: `docs/PRD.md`
- Jira project: `SMT` / Social Manager Thing
- Archived/scaffold source repo: `social-manager-scaffold` (archived)
