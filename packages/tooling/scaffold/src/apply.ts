import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildDbNames, buildNames, type NameSet } from './names.js'
import { planCrudScaffold } from './plan.js'
import type { ApplyScaffoldResult, CrudScaffoldOptions } from './types.js'

const exportLineRegex = /^export \* from ['"]\.\/[^'"]+\.js['"]$/

const extractExportLines = (content: string): string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => exportLineRegex.test(line))

const mergeIndexExports = async (absolutePath: string, plannedContent: string): Promise<boolean> => {
  const current = await readFile(absolutePath, 'utf8')
  const plannedLines = extractExportLines(plannedContent)
  const currentSet = new Set(extractExportLines(current))
  const missingLines = plannedLines.filter((line) => !currentSet.has(line))

  if (missingLines.length === 0) {
    return false
  }

  const currentWithNewline = current.endsWith('\n') ? current : `${current}\n`
  await writeFile(absolutePath, `${currentWithNewline}${missingLines.join('\n')}\n`, 'utf8')
  return true
}

const ensureBarrelExport = async (repoRoot: string, domainSlug: string): Promise<boolean> => {
  const coreIndexPath = join(repoRoot, 'packages/core/src/index.ts')
  const exportLine = `export * from './domains/${domainSlug}/index.js'`

  if (!existsSync(coreIndexPath)) {
    return false
  }

  const current = await readFile(coreIndexPath, 'utf8')
  if (current.includes(exportLine)) {
    return false
  }

  const next = current.endsWith('\n')
    ? `${current}${exportLine}\n`
    : `${current}\n${exportLine}\n`

  await writeFile(coreIndexPath, next, 'utf8')
  return true
}

const ensureLineInFile = async (
  repoRoot: string,
  relativePath: string,
  line: string
): Promise<boolean> => {
  const absolutePath = join(repoRoot, relativePath)
  if (!existsSync(absolutePath)) {
    return false
  }

  const current = await readFile(absolutePath, 'utf8')
  if (current.includes(line)) {
    return false
  }

  const next = current.endsWith('\n') ? `${current}${line}\n` : `${current}\n${line}\n`
  await writeFile(absolutePath, next, 'utf8')
  return true
}

const ensureDbSchemaTable = async (repoRoot: string, names: NameSet): Promise<boolean> => {
  const schemaPath = join(repoRoot, 'packages/infra/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    return false
  }

  const dbNames = buildDbNames(names)
  const tableDeclaration = `export const ${dbNames.tableConst} = pgTable('${dbNames.tableSqlName}', {`
  const rowTypeDeclaration = `export type ${names.Domain}${names.Entity}Row = typeof ${dbNames.tableConst}.$inferSelect`
  const current = await readFile(schemaPath, 'utf8')

  if (current.includes(tableDeclaration)) {
    return false
  }

  const snippet = `
export const ${dbNames.tableConst} = pgTable('${dbNames.tableSqlName}', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

${rowTypeDeclaration}
`

  const marker = 'export const usersRelations = relations(users, ({ many }) => ({'
  const next = current.includes(marker)
    ? current.replace(marker, `${snippet}\n${marker}`)
    : `${current}\n${snippet}\n`

  await writeFile(schemaPath, next, 'utf8')
  return true
}

const ensureDbScaffoldWiring = async (
  repoRoot: string,
  names: NameSet
): Promise<string[]> => {
  const dbNames = buildDbNames(names)
  const updated: string[] = []

  if (await ensureDbSchemaTable(repoRoot, names)) {
    updated.push('packages/infra/db/src/schema.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/infra/db/src/effect-schemas/index.ts',
      `export * from './${dbNames.tableFileSlug}.js'`
    )
  ) {
    updated.push('packages/infra/db/src/effect-schemas/index.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/infra/db/src/factories/index.ts',
      `export * from './${dbNames.tableFileSlug}.factory.js'`
    )
  ) {
    updated.push('packages/infra/db/src/factories/index.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/infra/db/src/index.ts',
      `export { ${names.entity}DbRepository } from './repositories/${dbNames.tableFileSlug}.js'`
    )
  ) {
    updated.push('packages/infra/db/src/index.ts')
  }

  return updated
}

export const applyCrudScaffold = async (options: CrudScaffoldOptions): Promise<ApplyScaffoldResult> => {
  const plan = planCrudScaffold(options, { withDb: options.withDb })
  const written: string[] = []
  const skipped: string[] = []
  const updatedBarrels: string[] = []

  if (!options.dryRun) {
    for (const file of plan) {
      const absolutePath = join(options.repoRoot, file.path)
      await mkdir(dirname(absolutePath), { recursive: true })

      const exists = existsSync(absolutePath)
      const isIndexPath = file.path.endsWith('/index.ts')
      if (exists) {
        if (isIndexPath) {
          const merged = await mergeIndexExports(absolutePath, file.content)
          if (merged) {
            written.push(file.path)
          } else {
            skipped.push(file.path)
          }
          continue
        }

        if (!options.force) {
          skipped.push(file.path)
          continue
        }
      }

      await writeFile(absolutePath, file.content, 'utf8')
      written.push(file.path)
    }

    const names = buildNames(options)
    if (await ensureBarrelExport(options.repoRoot, names.domainSlug)) {
      updatedBarrels.push('packages/core/src/index.ts')
    }

    if (options.withDb) {
      const updatedDbFiles = await ensureDbScaffoldWiring(options.repoRoot, names)
      updatedBarrels.push(...updatedDbFiles)
    }
  }

  return {
    written,
    skipped,
    updatedBarrels,
    planned: plan.map((file) => file.path)
  }
}
