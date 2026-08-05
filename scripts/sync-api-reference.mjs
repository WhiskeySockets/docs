#!/usr/bin/env node
// Regenerates the API Reference and Protobuf sections from the Baileys sources.
//
// TypeDoc reads the library's TypeScript and emits one markdown file per
// exported symbol. This script converts that output into Mintlify MDX —
// rewriting the relative links TypeDoc emits into site routes, so readers can
// click from one type to another — and rewrites the generated tabs in docs.json.
//
//   node scripts/sync-api-reference.mjs                 # sync from Baileys master
//   node scripts/sync-api-reference.mjs --ref v7.0.0    # sync from a tag or branch
//   node scripts/sync-api-reference.mjs --check         # report staleness, write nothing
//
// Everything under api-reference/ and proto-reference/ is generated and will be
// overwritten, except the two hand-written overview pages.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_REPO = 'https://github.com/WhiskeySockets/Baileys.git'
const DEFAULT_REF = 'master'
const DOCS_JSON = join(REPO_ROOT, 'docs.json')
const METADATA = join(REPO_ROOT, 'scripts', 'api-reference-source.json')
const OPTIONS_TEMPLATE = join(REPO_ROOT, 'scripts', 'typedoc.baileys.json')

// The two sections this script owns, and the tab each renders as. The protobuf
// definitions are ~75% of the generated pages, so they get their own tab rather
// than burying the library's own API underneath them.
const API = 'api-reference'
const PROTO = 'proto-reference'
const TABS = {
  [API]: { en: 'API Reference', 'pt-BR': 'Referência da API' },
  [PROTO]: { en: 'Protobuf', 'pt-BR': 'Protobuf' }
}

// Hand-written pages inside the generated directories: never deleted, always
// first in their tab.
const OVERVIEWS = new Set([`${API}/overview.mdx`, `${PROTO}/overview.mdx`])

// TypeDoc's directory names, in the order they should appear in the sidebar.
const KIND_ORDER = ['functions', 'type-aliases', 'interfaces', 'classes', 'enumerations', 'variables']
const KIND_LABELS = {
  functions: 'Functions',
  'type-aliases': 'Type aliases',
  interfaces: 'Interfaces',
  classes: 'Classes',
  enumerations: 'Enumerations',
  variables: 'Variables'
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const refIndex = args.indexOf('--ref')
const ref = refIndex === -1 ? process.env.BAILEYS_REF || DEFAULT_REF : args[refIndex + 1]

if (!ref) fail('--ref needs a value (a branch name, tag, or commit SHA)')

const log = (message) => console.log(`[sync-api-reference] ${message}`)

function fail(message) {
  console.error(`[sync-api-reference] ${message}`)
  process.exit(1)
}

function run(command, commandArgs, cwd) {
  return execFileSync(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
}

// Streams output instead of capturing it, for the slow steps worth watching.
function runVerbose(command, commandArgs, cwd) {
  execFileSync(command, commandArgs, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
}

function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

// ---------------------------------------------------------------------------
// Route mapping
// ---------------------------------------------------------------------------

// TypeDoc nests the protobuf definitions under a `proto` namespace, producing
// paths like `namespaces/proto/namespaces/HistorySync/enumerations/Type.md`.
// Those move to their own section with the structural `namespaces/` segments
// dropped, so routes read as `proto-reference/HistorySync/enumerations/Type`.
function toRoute(relPath) {
  const parts = relPath.replace(/\.md$/, '').split('/')

  // A directory's `index.md` is its landing page.
  if (parts[parts.length - 1] === 'index') parts[parts.length - 1] = 'overview'

  if (parts[0] === 'namespaces' && parts[1] === 'proto') {
    const tail = parts.slice(2)
    const cleaned = tail.filter((part, index) => !(part === 'namespaces' && index < tail.length - 1))
    return [PROTO, ...cleaned].join('/')
  }

  return [API, ...parts].join('/')
}

// ---------------------------------------------------------------------------
// Markdown -> MDX
// ---------------------------------------------------------------------------

const stripMarkdown = (text) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const quote = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// Pulls the symbol's own description out of a page.
//
// TypeDoc puts the doc comment in the preamble — after the signature blockquote
// and the source link, before the first `##`. Anything past that first heading
// documents a member rather than the symbol, so the search stops there.
function describe(body, kind, name, section) {
  const preamble = body.split(/^## /m)[0]

  for (const raw of preamble.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('Defined in:')) continue
    if (/^[#>\-|[`]/.test(line) || line.startsWith('\\{')) continue

    // Judge on what is left once code spans and links are removed, so a line
    // that is really a type signature can't pass itself off as prose.
    const bare = line.replace(/`[^`]*`/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\\./g, ' ')
    if (bare.split(/\s+/).filter((word) => /[A-Za-z]{2}/.test(word)).length < 3) continue

    const sentence = stripMarkdown(line).split(/(?<=\.)\s/)[0]
    return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}...` : sentence
  }

  // Most protobuf types carry no comment: the schema they come from has none.
  return section === PROTO
    ? `Protobuf ${kind.toLowerCase()} ${name} generated from WAProto.`
    : `${kind} ${name} in the Baileys API.`
}

function convert(relPath, source) {
  const route = toRoute(relPath)
  const section = route.startsWith(`${PROTO}/`) ? PROTO : API
  const lines = source.split('\n')

  // The first heading is the page title, e.g. `# Type Alias: AnyMessageContent`.
  let kind = 'Symbol'
  let name = route.split('/').pop()
  const headingIndex = lines.findIndex((line) => line.startsWith('# '))
  if (headingIndex !== -1) {
    const heading = lines[headingIndex].slice(2).trim()
    const split = heading.match(/^([A-Za-z ]+):\s*(.+)$/)
    if (split) {
      kind = split[1]
      name = split[2]
    } else {
      name = heading
    }
    lines.splice(headingIndex, 1)
  }

  name = name.replace(/\\/g, '').replace(/\(\)$/, '').trim()

  // Mintlify renders the frontmatter title as the page's h1, so demote the
  // headings TypeDoc emits by one level to keep a single h1 per page.
  let body = lines
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd()

  // Rewrite TypeDoc's relative links into site routes. Absolute links (the
  // GitHub "Defined in" links) and bare anchors are left alone.
  body = body.replace(/\]\((?!https?:|\/|#)([^)\s]+?\.md)(#[^)\s]*)?\)/g, (_match, target, fragment = '') => {
    const resolved = posix.normalize(posix.join(posix.dirname(relPath), target))
    return `](/${toRoute(resolved)}${fragment})`
  })

  const frontmatter = [
    '---',
    `title: ${quote(name)}`,
    `description: ${quote(describe(body, kind, name, section))}`,
    '---'
  ]
  return { route, content: `${frontmatter.join('\n')}\n\n${body}\n` }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// Landing pages first, then alphabetical.
function compareRoutes(a, b) {
  const aOverview = a.endsWith('/overview')
  const bOverview = b.endsWith('/overview')
  if (aOverview !== bOverview) return aOverview ? -1 : 1
  return a.localeCompare(b, 'en')
}

// Rebuilds the directory layout as a nested navigation tree: kind directories
// become groups, namespace directories become nested groups.
function buildTree(routes, prefix) {
  const pages = []
  const directories = new Map()

  for (const route of routes) {
    const rest = route.slice(prefix.length + 1)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      pages.push(route)
      continue
    }
    const head = rest.slice(0, slash)
    if (!directories.has(head)) directories.set(head, [])
    directories.get(head).push(route)
  }

  const rank = (key) => {
    const index = KIND_ORDER.indexOf(key)
    return index === -1 ? KIND_ORDER.length : index
  }
  const keys = [...directories.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en'))

  return [
    ...pages.sort(compareRoutes),
    ...keys.map((key) => ({
      group: KIND_LABELS[key] || key,
      pages: buildTree(directories.get(key), `${prefix}/${key}`)
    }))
  ]
}

function sectionTab(section, routes, label) {
  const overview = `${section}/overview`
  const entries = buildTree(
    routes.filter((route) => route !== overview),
    section
  )
  return {
    tab: label,
    groups: [
      { group: 'About', pages: [overview, ...entries.filter((entry) => typeof entry === 'string')] },
      ...entries.filter((entry) => typeof entry !== 'string')
    ]
  }
}

function renderDocsJson(routesBySection) {
  const docs = JSON.parse(readFileSync(DOCS_JSON, 'utf8'))
  const languages = docs.navigation?.languages
  if (!Array.isArray(languages)) fail('docs.json has no navigation.languages array')

  const generatedLabels = new Set(Object.values(TABS).flatMap((labels) => Object.values(labels)))
  const handWritten = (tabs) => (tabs || []).filter((tab) => !generatedLabels.has(tab.tab))

  const en = languages.find((entry) => entry.language === 'en')
  if (!en) fail('docs.json has no "en" language block')
  en.tabs = [
    ...handWritten(en.tabs),
    ...Object.entries(routesBySection).map(([section, routes]) => sectionTab(section, routes, TABS[section].en))
  ]

  // The generated pages are English only, so other languages get link tabs into
  // them rather than a second copy of the same routes under a translated path.
  for (const language of languages) {
    if (language.language === 'en') continue
    const labels = Object.keys(routesBySection).map((section) => ({
      tab: TABS[section][language.language] || TABS[section].en,
      href: `/${section}/overview`
    }))
    language.tabs = [...handWritten(language.tabs), ...labels]
  }

  return `${JSON.stringify(docs, null, 2)}\n`
}

// ---------------------------------------------------------------------------

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'baileys-typedoc-')))
const checkout = join(workdir, 'Baileys')

try {
  log(`cloning ${SOURCE_REPO} at ${ref}`)
  run('git', ['clone', '--depth', '1', '--branch', ref, SOURCE_REPO, checkout], workdir)

  const sha = run('git', ['rev-parse', 'HEAD'], checkout).trim()
  const version = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).version
  log(`resolved ${ref} to ${sha.slice(0, 12)} (baileys@${version})`)

  // --ignore-scripts skips the library's `prepare` build. TypeDoc reads the
  // TypeScript sources directly, so a compiled lib/ is not needed and the build
  // is the slowest part of a plain install.
  log('installing library dependencies')
  const installArgs = existsSync(join(checkout, 'package-lock.json'))
    ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['install', '--ignore-scripts', '--no-audit', '--no-fund']
  runVerbose('npm', installArgs, checkout)

  // The library's own typedoc.json is tuned for its standalone docs build, so
  // the site ships the options it needs. Pinning gitRevision to the ref keeps
  // the "Defined in" links stable between runs — without it every source URL
  // embeds the current commit SHA and all 1,700 pages churn on every sync.
  const options = JSON.parse(readFileSync(OPTIONS_TEMPLATE, 'utf8'))
  options.gitRevision = ref
  options.out = 'typedoc-markdown'
  const optionsFile = 'typedoc.mintlify.json'
  writeFileSync(join(checkout, optionsFile), JSON.stringify(options, null, 2))

  // The options path stays relative to the checkout: on macOS an absolute path
  // resolves through the /var -> /private/var symlink, and TypeDoc then fails to
  // match its entry point against the tsconfig `include`.
  log('running typedoc')
  runVerbose(join(checkout, 'node_modules', '.bin', 'typedoc'), ['--options', `./${optionsFile}`], checkout)

  const generatedDir = join(checkout, 'typedoc-markdown')
  if (!existsSync(generatedDir)) fail('typedoc produced no markdown output')

  const sourceFiles = walk(generatedDir).filter((file) => file.endsWith('.md'))
  if (!sourceFiles.length) fail('typedoc produced no markdown pages')
  log(`converting ${sourceFiles.length} pages`)

  const pages = new Map()
  const routesBySection = { [API]: [`${API}/overview`], [PROTO]: [`${PROTO}/overview`] }

  for (const relPath of sourceFiles) {
    const { route, content } = convert(relPath, readFileSync(join(generatedDir, relPath), 'utf8'))

    // The two section landing pages are hand-written; TypeDoc's top-level index
    // pages just restate the sidebar.
    if (route === `${API}/overview` || route === `${PROTO}/overview`) continue

    pages.set(route, content)
    routesBySection[route.startsWith(`${PROTO}/`) ? PROTO : API].push(route)
  }

  for (const routes of Object.values(routesBySection)) routes.sort(compareRoutes)

  // Work out what would change before touching anything, so --check can report
  // staleness without leaving the tree dirty.
  const stale = []
  for (const [route, content] of pages) {
    const target = join(REPO_ROOT, `${route}.mdx`)
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) stale.push(`${route}.mdx`)
  }

  const orphans = []
  for (const section of [API, PROTO]) {
    const dir = join(REPO_ROOT, section)
    if (!existsSync(dir)) continue
    for (const file of walk(dir)) {
      const key = `${section}/${file}`
      if (OVERVIEWS.has(key) || pages.has(key.replace(/\.mdx$/, ''))) continue
      orphans.push(key)
    }
  }

  const nextDocsJson = renderDocsJson(routesBySection)
  const docsJsonStale = readFileSync(DOCS_JSON, 'utf8') !== nextDocsJson

  const metadata = `${JSON.stringify(
    {
      source: 'https://github.com/WhiskeySockets/Baileys',
      ref,
      commit: sha,
      version,
      pages: pages.size,
      generator: 'typedoc + typedoc-plugin-markdown'
    },
    null,
    2
  )}\n`
  const metadataStale = !existsSync(METADATA) || readFileSync(METADATA, 'utf8') !== metadata

  const changed = stale.length > 0 || orphans.length > 0 || docsJsonStale || metadataStale

  if (check) {
    if (changed) {
      log(`${stale.length} pages out of date, ${orphans.length} orphaned, docs.json ${docsJsonStale ? 'stale' : 'current'}`)
      fail('generated reference is stale — run `node scripts/sync-api-reference.mjs` and commit the result')
    }
    log(`generated reference is up to date (${pages.size} pages)`)
    console.log('changed=false')
    process.exit(0)
  }

  for (const [route, content] of pages) {
    const target = join(REPO_ROOT, `${route}.mdx`)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) writeFileSync(target, content)
  }
  for (const orphan of orphans) rmSync(join(REPO_ROOT, orphan))
  if (docsJsonStale) writeFileSync(DOCS_JSON, nextDocsJson)
  if (metadataStale) writeFileSync(METADATA, metadata)

  log(
    `${pages.size} pages written (${routesBySection[API].length} api, ${routesBySection[PROTO].length} protobuf), ` +
      `${stale.length} changed, ${orphans.length} removed`
  )
  console.log(`changed=${changed}`)
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
