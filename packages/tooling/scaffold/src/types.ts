export interface CrudScaffoldInput {
  domain: string
  entity: string
  plural?: string
}

export interface CrudScaffoldOptions extends CrudScaffoldInput {
  repoRoot: string
  dryRun?: boolean
  force?: boolean
  withDb?: boolean
}

export interface PlannedFile {
  path: string
  content: string
}

export interface ApplyScaffoldResult {
  written: string[]
  skipped: string[]
  updatedBarrels: string[]
  planned: string[]
}
