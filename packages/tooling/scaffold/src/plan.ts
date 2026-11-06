import {
  apiDomainFile,
  apiDomainRootIndexFile,
  apiPortFile,
  apiRepositoryFile,
  apiRoutesFile,
  apiRoutesTestFile,
  apiServiceFile
} from './api-templates.js'
import {
  coreDomainFile,
  corePortFile,
  coreRepositoryFile,
  coreRuntimeFile,
  coreServiceFile,
  coreServiceTestFile,
  domainRootIndexFile
} from './core-templates.js'
import { dbEffectSchemaFile, dbFactoryFile, dbRepositoryFile } from './db-templates.js'
import { buildDbNames, buildNames, type NameSet } from './names.js'
import type { CrudScaffoldInput, PlannedFile } from './types.js'

const indexFile = (exportTargets: string[]): string =>
  exportTargets.map((target) => `export * from './${target}.js'`).join('\n').concat('\n')

const coreFilePlan = (n: NameSet): PlannedFile[] => {
  const basePath = `packages/core/src/domains/${n.domainSlug}`

  return [
    { path: `${basePath}/domain/${n.entitySlug}.ts`, content: coreDomainFile(n) },
    { path: `${basePath}/domain/index.ts`, content: indexFile([n.entitySlug]) },
    { path: `${basePath}/ports/${n.entitySlug}-store-port.ts`, content: corePortFile(n) },
    { path: `${basePath}/ports/index.ts`, content: indexFile([`${n.entitySlug}-store-port`]) },
    { path: `${basePath}/adapters/${n.entitySlug}-store-adapter.ts`, content: coreRepositoryFile(n) },
    { path: `${basePath}/adapters/index.ts`, content: indexFile([`${n.entitySlug}-store-adapter`]) },
    { path: `${basePath}/application/${n.entitySlug}-service.ts`, content: coreServiceFile(n) },
    { path: `${basePath}/application/index.ts`, content: indexFile([`${n.entitySlug}-service`]) },
    { path: `${basePath}/runtime/${n.entitySlug}-live.ts`, content: coreRuntimeFile(n) },
    { path: `${basePath}/runtime/index.ts`, content: indexFile([`${n.entitySlug}-live`]) },
    { path: `${basePath}/application/${n.entitySlug}-service.test.ts`, content: coreServiceTestFile(n) },
    { path: `${basePath}/index.ts`, content: domainRootIndexFile() }
  ]
}

const apiFilePlan = (n: NameSet): PlannedFile[] => {
  const basePath = `apps/api/src/domains/${n.domainSlug}`

  return [
    { path: `${basePath}/domain/${n.entitySlug}-contracts.ts`, content: apiDomainFile(n) },
    { path: `${basePath}/domain/index.ts`, content: indexFile([`${n.entitySlug}-contracts`]) },
    { path: `${basePath}/ports/${n.entitySlug}-route-port.ts`, content: apiPortFile(n) },
    { path: `${basePath}/ports/index.ts`, content: indexFile([`${n.entitySlug}-route-port`]) },
    { path: `${basePath}/adapters/${n.entitySlug}-service-adapter.ts`, content: apiRepositoryFile(n) },
    { path: `${basePath}/adapters/index.ts`, content: indexFile([`${n.entitySlug}-service-adapter`]) },
    { path: `${basePath}/application/${n.entitySlug}-route-service.ts`, content: apiServiceFile(n) },
    { path: `${basePath}/application/index.ts`, content: indexFile([`${n.entitySlug}-route-service`]) },
    { path: `${basePath}/routes/${n.entitySlug}.ts`, content: apiRoutesFile(n) },
    { path: `${basePath}/routes/index.ts`, content: indexFile([n.entitySlug]) },
    { path: `${basePath}/routes/${n.entitySlug}.test.ts`, content: apiRoutesTestFile(n) },
    { path: `${basePath}/index.ts`, content: apiDomainRootIndexFile() }
  ]
}

const dbFilePlan = (n: NameSet): PlannedFile[] => {
  const dbNames = buildDbNames(n)
  return [
    {
      path: `packages/infra/db/src/effect-schemas/${dbNames.tableFileSlug}.ts`,
      content: dbEffectSchemaFile(n)
    },
    {
      path: `packages/infra/db/src/factories/${dbNames.tableFileSlug}.factory.ts`,
      content: dbFactoryFile(n, dbNames)
    },
    {
      path: `packages/infra/db/src/repositories/${dbNames.tableFileSlug}.ts`,
      content: dbRepositoryFile(n, dbNames)
    }
  ]
}

export const planCrudScaffold = (
  input: CrudScaffoldInput,
  options: { withDb?: boolean } = {}
): PlannedFile[] => {
  const names = buildNames(input)
  const basePlan = [...coreFilePlan(names), ...apiFilePlan(names)]
  if (!options.withDb) {
    return basePlan
  }

  return [...basePlan, ...dbFilePlan(names)]
}
