# Documentation project instructions

This is the Mintlify documentation site for [Baileys](https://github.com/WhiskeySockets/Baileys), the WhatsApp Web API library.

- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Run `mint dev` to preview locally
- Run `mint broken-links` to check links

## Translation parity (English ↔ pt-BR) — load-bearing rule

The site ships in two languages: English at the repo root and Brazilian Portuguese under `pt-BR/`. Every English page has a pt-BR mirror at the same relative path. **The two languages must stay structurally in sync.**

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
