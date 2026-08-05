# Documentation project instructions

This is the Mintlify documentation site for [Baileys](https://github.com/WhiskeySockets/Baileys), the WhatsApp Web API library.

- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Run `mint dev` to preview locally
- Run `mint broken-links` to check links

## Translation parity (English ↔ pt-BR) — load-bearing rule

The site ships in two languages: English at the repo root and Brazilian Portuguese under `pt-BR/`. Every English page has a pt-BR mirror at the same relative path. **The two languages must stay structurally in sync.**

This rule covers hand-written pages. The generated `api-reference/` and `proto-reference/` sections are exempt — see "Generated reference sections" below.

When you change a page in either language:

1. **Mirror the change in the other language in the same commit.** The docs ship from `main` and an out-of-sync pt-BR is treated as a bug, not a follow-up.
2. **Heading structure must match 1:1.** Every `##` and `###` in English must have an equivalent in pt-BR (and vice versa). Translate the heading text — never drop sections.
3. **Don't strip explanatory paragraphs in pt-BR.** Earlier translations were heavily abbreviated; this rule exists to stop that drift. If a paragraph exists in English, translate it. Do not collapse multiple paragraphs into one.
4. **Code blocks stay identical.** Identifiers, parameter names, and code-level comments inside fenced blocks are not translated. Only translate clearly user-facing prose comments.
5. **Frontmatter `title` and `description` must both be translated** and stay short (see "Titles and descriptions" below).
6. **`docs.json` navigation must mirror.** Every English page entry has a `pt-BR/<path>` counterpart in the pt-BR language block, in the same group order.

To audit parity quickly:

```bash
# heading counts should match
diff <(grep -E '^#{1,4} ' page.mdx) <(grep -E '^#{1,4} ' pt-BR/page.mdx)
# line ratio gives a rough drift signal
echo "scale=2; $(wc -l < pt-BR/page.mdx) / $(wc -l < page.mdx)" | bc
```

If you only know one language well enough to write idiomatic prose, still update the other side — a literal translation that preserves structure is better than silent drift.

## Generated reference sections

`api-reference/` and `proto-reference/` are **generated — never edit them by hand.** The next sync overwrites the lot.

- `api-reference/` — everything the `baileys` package exports (~417 pages).
- `proto-reference/` — the `proto` namespace generated from `WAProto.proto` (~1,330 pages). It lives in its own tab because it would otherwise bury the library's own API four to one.

Both come from one command, which clones Baileys, runs TypeDoc with `typedoc-plugin-markdown`, converts the output to MDX, and rewrites the two generated tabs in `docs.json`:

```bash
node scripts/sync-api-reference.mjs              # sync from Baileys master
node scripts/sync-api-reference.mjs --ref v7.0.0 # sync from a tag or branch
node scripts/sync-api-reference.mjs --check      # report staleness, write nothing
```

`.github/workflows/sync-api-reference.yml` runs it daily and commits when the public API changes. A release workflow in the library repo can also trigger it with a `baileys-release` `repository_dispatch`.

Things worth knowing before you touch the script:

- **Two files in those directories are hand-written**: `api-reference/overview.mdx` and `proto-reference/overview.mdx`. The sync preserves them and puts them first in their tab. Everything else is deleted if it no longer corresponds to an exported symbol.
- **`gitRevision` is pinned to the ref, not the commit SHA.** Unpinned, every "Defined in" link embeds the current SHA and all 1,747 pages churn on every run, which would defeat the "commit only when the API changed" check.
- **TypeDoc's relative links are rewritten to site routes** so readers can click from a type to the types it mentions. If you change the route layout, change `toRoute` — the link rewriter and the navigation builder both go through it.
- **Translation parity does not apply.** The pages are machine-generated from English doc comments, so pt-BR gets link tabs pointing into the English sections rather than a translated copy. The sync writes those link tabs for every non-English language in `docs.json`.
- **Descriptions come from the symbol's own doc comment**, taken from the preamble before the first `##`. Anything after that documents a member, not the symbol.
- **Prose corrections belong in the library**, not here. Doc comments live in `WhiskeySockets/Baileys`.

## Titles and descriptions

Frontmatter `title` and `description` render as the page header, the sidebar entry, and the SEO metadata. Bloat there reads as marketing copy in the navigation.

- **Title**: 2–6 words. The topic, not a sentence. Prefer "Send messages" over "Send text, media, polls, and reactions with Baileys".
- **Description**: one short sentence (under ~140 chars) that says what the page covers. Don't restate the title; don't pile on keywords.

## Style preferences

- Active voice and second person ("you")
- Sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references
- No emojis unless the user explicitly asks

## Sourcing content

- [`WhiskeySockets/Baileys`](https://github.com/WhiskeySockets/Baileys) — source of truth for APIs, types, and runtime behavior. Cross-check the source before documenting an API.
- [`WhiskeySockets/baileys.wiki-site`](https://github.com/WhiskeySockets/baileys.wiki-site) — long-form guides; many pages there are stubs, so prefer the main repo and `src/Types/` for canonical detail.

When importing content, rewrite in the site's voice rather than copying verbatim.
