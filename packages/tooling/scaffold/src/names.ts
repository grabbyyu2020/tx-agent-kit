import type { CrudScaffoldInput } from './types.js'

export interface NameSet {
  domainSlug: string
  entitySlug: string
  pluralSlug: string
  Domain: string
  Entity: string
  Entities: string
  entity: string
}

const ensureValidName = (value: string, label: string): void => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'. Use only letters, numbers, hyphen, and underscore.`)
  }
}

const toKebabCase = (value: string): string =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/[\s_]+/g, '-')
    .toLowerCase()

const toPascalCase = (value: string): string =>
  toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const toCamelCase = (value: string): string => {
  const pascal = toPascalCase(value)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

const inferPlural = (entitySlug: string): string => {
  if (entitySlug.endsWith('s')) {
    return entitySlug
  }

  if (entitySlug.endsWith('y')) {
    return `${entitySlug.slice(0, -1)}ies`
  }

  return `${entitySlug}s`
}

export const buildNames = (input: CrudScaffoldInput): NameSet => {
  ensureValidName(input.domain, 'domain')
  ensureValidName(input.entity, 'entity')
  if (input.plural) {
    ensureValidName(input.plural, 'plural')
  }

  const domainSlug = toKebabCase(input.domain)
  const entitySlug = toKebabCase(input.entity)
  const pluralSlug = input.plural ? toKebabCase(input.plural) : inferPlural(entitySlug)

  return {
    domainSlug,
    entitySlug,
    pluralSlug,
    Domain: toPascalCase(domainSlug),
    Entity: toPascalCase(entitySlug),
    Entities: toPascalCase(pluralSlug),
    entity: toCamelCase(entitySlug)
  }
}

export interface DbNameSet {
  tableConst: string
  tableSqlName: string
  tableFileSlug: string
}

export const buildDbNames = (n: NameSet): DbNameSet => {
  const tableFileSlug = `${n.domainSlug}-${n.pluralSlug}`
  return {
    tableConst: toCamelCase(tableFileSlug),
    tableSqlName: tableFileSlug.replaceAll('-', '_'),
    tableFileSlug
  }
}
