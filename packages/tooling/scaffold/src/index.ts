import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { applyCrudScaffold } from './apply.js'
import type { CrudScaffoldOptions } from './types.js'

export type { ApplyScaffoldResult, CrudScaffoldInput, CrudScaffoldOptions, PlannedFile } from './types.js'
export { planCrudScaffold } from './plan.js'
export { applyCrudScaffold } from './apply.js'
export { CrudArgsUsage, parseCrudArgs } from './args.js'

export const scaffoldSummary = async (options: CrudScaffoldOptions): Promise<string> => {
  const result = await applyCrudScaffold(options)

  const lines = [
    `Planned files: ${result.planned.length}`,
    `Written files: ${result.written.length}`,
    `Skipped files: ${result.skipped.length}`,
    `Updated barrels: ${result.updatedBarrels.length}`
  ]

  if (options.dryRun) {
    lines.push('Dry run only: no files were written.')
  }

  return lines.join('\n')
}

export const inspectFile = async (path: string): Promise<{ exists: boolean; size: number }> => {
  if (!existsSync(path)) {
    return { exists: false, size: 0 }
  }

  const fileStat = await stat(path)
  return {
    exists: true,
    size: fileStat.size
  }
}
