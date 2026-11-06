#!/usr/bin/env node
// Keeps the AI workflow wiring honest: pstack's installed copy matches its snapshot, project
// playbooks still anchor to pstack's steps, and every project-constraints rule points at an
// enforcer that exists.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { checkPstackInstall } from '../agents/sync-pstack.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skillRoot = join(repoRoot, '.claude/skills/project-constraints')
const eslintConfigDir = join(repoRoot, 'packages/tooling/eslint-config')
const errors = []
const unenforced = []

const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8')

const escapeRegExp = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const eslintSources = readdirSync(eslintConfigDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(eslintConfigDir, name), 'utf8'))
  .join('\n')

const eslintRuleExists = (ruleId) => {
  const quoted = new RegExp(`['"]${escapeRegExp(ruleId)}['"]`, 'u')
  const bareKey = new RegExp(`(^|[\\s{,])${escapeRegExp(ruleId)}\\s*:`, 'mu')
  return quoted.test(eslintSources) || (!ruleId.includes('/') && bareKey.test(eslintSources))
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim())

const checkReference = (fileName, seenIds) => {
  const relativePath = `.claude/skills/project-constraints/references/${fileName}`
  const text = read(relativePath)
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? ''
  if (!/^paths:\n(\s+- .+\n?)+/mu.test(frontmatter)) {
    errors.push(`${relativePath}: frontmatter needs a non-empty \`paths:\` list`)
  }

  let rows = 0
  for (const line of text.split('\n')) {
    const cells = splitRow(line)
    if (!line.trim().startsWith('|') || cells.length !== 3 || !/^[A-Z]+-\d{2}$/u.test(cells[0])) {
      continue
    }
    rows += 1
    const [id, , enforcedBy] = cells
    if (seenIds.has(id)) {
      errors.push(`${relativePath}: rule ${id} is also defined in ${seenIds.get(id)}`)
    }
    seenIds.set(id, relativePath)

    const tokens = [...enforcedBy.matchAll(/`(eslint|script):([^`]+)`/gu)]
    if (tokens.length === 0) {
      if (enforcedBy.startsWith('none')) {
        unenforced.push(id)
      } else {
        errors.push(`${relativePath}: ${id} needs \`eslint:<rule>\`, \`script:<path>\`, or none in "Enforced by"`)
      }
      continue
    }
    for (const [, kind, target] of tokens) {
      if (kind === 'eslint' && !eslintRuleExists(target)) {
        errors.push(`${relativePath}: ${id} cites eslint rule \`${target}\`, which no config in packages/tooling/eslint-config sets`)
      }
      if (kind === 'script' && !existsSync(join(repoRoot, target))) {
        errors.push(`${relativePath}: ${id} cites \`${target}\`, which does not exist`)
      }
    }
  }
  if (rows === 0) {
    errors.push(`${relativePath}: no rule rows found (expected | ID | Rule | Enforced by |)`)
  }
}

const checkConstraintsSkill = () => {
  const skill = read('.claude/skills/project-constraints/SKILL.md')
  const referenceFiles = readdirSync(join(skillRoot, 'references'))
    .filter((name) => name.endsWith('.md'))
    .sort()
  const seenIds = new Map()
  for (const fileName of referenceFiles) {
    if (!skill.includes(`(references/${fileName})`)) {
      errors.push(`.claude/skills/project-constraints/SKILL.md: the Areas table does not link references/${fileName}`)
    }
    checkReference(fileName, seenIds)
  }
  for (const [, id] of skill.matchAll(/\b([A-Z]+-\d{2})\b/gu)) {
    if (!seenIds.has(id)) {
      errors.push(`.claude/skills/project-constraints/SKILL.md: cites ${id}, which no reference defines`)
    }
  }
}

const checkPlaybooks = () => {
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, '.claude/skills/poteto-mode/scripts/check-playbooks.mjs'), repoRoot],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    errors.push(`.agents/playbooks: ${(result.stdout + result.stderr).trim()}`)
  }
}

const checkInstructionFiles = () => {
  if (read('CLAUDE.md') !== '@AGENTS.md\n') {
    errors.push('CLAUDE.md must contain exactly `@AGENTS.md` so Claude Code and Amp read one instruction file')
  }
  if (!read('AGENTS.md').includes('project-constraints')) {
    errors.push('AGENTS.md must tell agents to load the project-constraints skill before changing code')
  }
  const settings = JSON.parse(read('.claude/settings.json'))
  if ('hooks' in settings) {
    errors.push('.claude/settings.json must not define hooks; this repository keeps its workflow in skills and lint')
  }
}

errors.push(...checkPstackInstall().map((problem) => `${problem} (run \`pnpm pstack:sync\`)`))
checkConstraintsSkill()
checkPlaybooks()
checkInstructionFiles()

if (errors.length > 0) {
  console.error('Agent workflow contract violations:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(
  `Agent workflow contracts passed. ${unenforced.length} project-constraints rules have no mechanical enforcer: ${unenforced.join(', ')}`
)
