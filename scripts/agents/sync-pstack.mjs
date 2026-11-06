#!/usr/bin/env node
// Installs the vendored pstack snapshot (.skill-sources/pstack) as project-local Claude Code
// skills and agents. Without the plugin install, agents register under bare names, so plugin
// namespaces and plugin-root paths are rewritten. `--check` fails when the installed copy drifts.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = join(repoRoot, '.skill-sources/pstack')

// Skills this repository owns. They live beside pstack in .claude/skills and are never synced.
export const projectSkills = ['project-constraints']

const pstackAgents = [
  'poteto-agent',
  'comment-sicko',
  'thermo-nuclear-review-subagent',
  'thermo-nuclear-code-quality-review-subagent'
]

// Tool mappings for runtimes other than Claude Code describe their own plugin naming; leave them as shipped.
const isOtherRuntimeDoc = (path) =>
  /^skills\/poteto-mode\/references\/[a-z]+-tools\.md$/u.test(path) ||
  path === 'skills/poteto-mode/references/grok.md' ||
  path === 'skills/setup-pstack/copilot.md'

const rewrites = [
  {
    name: 'bare agent names',
    from: new RegExp(`pstack:(${pstackAgents.join('|')})\\b`, 'gu'),
    to: '$1'
  },
  {
    name: 'plugin namespace note',
    from: ' Plugin agents register under the plugin namespace. The bare name `poteto-agent` errors.',
    to: ''
  },
  {
    name: 'plugin-root script paths',
    from: /<plugin>\/skills\//gu,
    to: '.claude/skills/'
  },
  {
    name: 'poteto-agent skill lookup',
    from: /With no path, before any other work, search `\$\{CLAUDE_CODE_PLUGIN_CACHE_DIR[^`]*`.*?If no such file exists, stop and tell your parent\./u,
    to: 'With no path, read `.claude/skills/poteto-mode/SKILL.md` from the repository root before any other work. If that file does not exist, stop and tell your parent.'
  }
]

const toPosix = (value) => value.split(sep).join('/')

const listFiles = (root) => {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else {
        files.push(toPosix(relative(root, path)))
      }
    }
  }
  if (existsSync(root)) {
    walk(root)
  }
  return files.sort()
}

const pstackSkillNames = () =>
  readdirSync(join(sourceRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

// Writes skills/ and agents/ for a fresh install under `outRoot` (a stand-in for .claude/).
const build = (outRoot) => {
  cpSync(join(sourceRoot, 'skills'), join(outRoot, 'skills'), { recursive: true })
  cpSync(join(sourceRoot, 'agents'), join(outRoot, 'agents'), { recursive: true })

  const hits = new Map(rewrites.map((rewrite) => [rewrite.name, 0]))
  for (const path of listFiles(outRoot)) {
    if (!path.endsWith('.md') || isOtherRuntimeDoc(path)) {
      continue
    }
    const file = join(outRoot, path)
    let text = readFileSync(file, 'utf8')
    for (const rewrite of rewrites) {
      const next = text.replace(rewrite.from, rewrite.to)
      if (next !== text) {
        hits.set(rewrite.name, hits.get(rewrite.name) + 1)
        text = next
      }
    }
    const leftover = text.match(/pstack:[a-z]/u)
    if (leftover) {
      throw new Error(`${path}: unhandled plugin namespace "${leftover[0]}..."; extend the rewrite table`)
    }
    writeFileSync(file, text)
  }

  const unused = [...hits].filter(([, count]) => count === 0).map(([name]) => name)
  if (unused.length > 0) {
    throw new Error(`rewrites matched nothing (upstream changed?): ${unused.join(', ')}`)
  }
}

const sameFile = (a, b) =>
  readFileSync(a).equals(readFileSync(b)) && (statSync(a).mode & 0o111) === (statSync(b).mode & 0o111)

export const checkPstackInstall = () => {
  const scratch = mkdtempSync(join(tmpdir(), 'pstack-sync-'))
  try {
    build(scratch)
    const problems = []
    const claudeRoot = join(repoRoot, '.claude')
    const expectedSkills = new Set(pstackSkillNames())

    for (const name of readdirSync(join(claudeRoot, 'skills'))) {
      if (!expectedSkills.has(name) && !projectSkills.includes(name)) {
        problems.push(`.claude/skills/${name} is neither a pstack skill nor listed in projectSkills`)
      }
    }
    for (const name of readdirSync(join(claudeRoot, 'agents'))) {
      if (!pstackAgents.includes(name.replace(/\.md$/u, ''))) {
        problems.push(`.claude/agents/${name} is not a pstack agent`)
      }
    }

    const expected = listFiles(scratch)
    const installed = new Set(
      listFiles(claudeRoot).filter((path) => {
        const [top, name] = path.split('/')
        return top === 'agents' || (top === 'skills' && expectedSkills.has(name))
      })
    )
    for (const path of expected) {
      if (!installed.has(path)) {
        problems.push(`.claude/${path} is missing`)
      } else if (!sameFile(join(scratch, path), join(claudeRoot, path))) {
        problems.push(`.claude/${path} differs from the synced snapshot`)
      }
      installed.delete(path)
    }
    for (const path of installed) {
      problems.push(`.claude/${path} is not in the snapshot`)
    }
    return problems
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const install = () => {
  const claudeRoot = join(repoRoot, '.claude')
  for (const name of pstackSkillNames()) {
    rmSync(join(claudeRoot, 'skills', name), { recursive: true, force: true })
  }
  rmSync(join(claudeRoot, 'agents'), { recursive: true, force: true })

  const scratch = mkdtempSync(join(tmpdir(), 'pstack-sync-'))
  try {
    build(scratch)
    cpSync(scratch, claudeRoot, { recursive: true })
    for (const path of listFiles(scratch)) {
      chmodSync(join(claudeRoot, path), statSync(join(scratch, path)).mode)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const problems = checkPstackInstall()
    for (const problem of problems) {
      console.error(problem)
    }
    if (problems.length > 0) {
      console.error('Run `node scripts/agents/sync-pstack.mjs` to reinstall pstack from .skill-sources/pstack.')
      process.exit(1)
    }
  } else {
    install()
    console.log('pstack installed into .claude/skills and .claude/agents')
  }
}
