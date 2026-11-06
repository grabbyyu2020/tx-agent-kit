import type { CrudScaffoldInput } from './types.js'

export const CrudArgsUsage =
  'Usage: --domain <name> --entity <name> [--plural <name>] [--dry-run] [--force] [--with-db]'

const valueCrudFlags = new Set(['--domain', '--entity', '--plural'])
const booleanCrudFlags = new Set(['--dry-run', '--force', '--with-db'])

const parseInlineCrudOption = (arg: string): { flag: string; value: string } | null => {
  if (!arg.startsWith('--') || !arg.includes('=')) {
    return null
  }

  const separatorIndex = arg.indexOf('=')
  return {
    flag: arg.slice(0, separatorIndex),
    value: arg.slice(separatorIndex + 1)
  }
}

const usageError = (message: string): Error => new Error(`${message}\n${CrudArgsUsage}`)

const parseInlineBoolean = (value: string, flag: string): boolean => {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  throw usageError(`Invalid boolean value for ${flag}: ${value}`)
}

export const parseCrudArgs = (
  argv: string[]
): CrudScaffoldInput & { dryRun: boolean; force: boolean; withDb: boolean } => {
  let domain = ''
  let entity = ''
  let plural: string | undefined
  let dryRun = false
  let force = false
  let withDb = false
  const seenFlags = new Set<string>()

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) {
      continue
    }

    const inlineOption = parseInlineCrudOption(arg)

    if (inlineOption) {
      const { flag, value } = inlineOption
      if (valueCrudFlags.has(flag)) {
        if (seenFlags.has(flag)) {
          throw usageError(`Duplicate option: ${flag}`)
        }

        if (!value.trim()) {
          throw usageError(`Missing value for ${flag}`)
        }

        if (flag === '--domain') {
          domain = value
        } else if (flag === '--entity') {
          entity = value
        } else {
          plural = value
        }

        seenFlags.add(flag)
        continue
      }

      if (booleanCrudFlags.has(flag)) {
        if (seenFlags.has(flag)) {
          throw usageError(`Duplicate option: ${flag}`)
        }

        const parsed = parseInlineBoolean(value, flag)
        if (flag === '--dry-run') {
          dryRun = parsed
        } else if (flag === '--force') {
          force = parsed
        } else {
          withDb = parsed
        }

        seenFlags.add(flag)
        continue
      }

      throw usageError(`Unknown option: ${flag}`)
    }

    if (booleanCrudFlags.has(arg)) {
      if (seenFlags.has(arg)) {
        throw usageError(`Duplicate option: ${arg}`)
      }

      if (arg === '--dry-run') {
        dryRun = true
      } else if (arg === '--force') {
        force = true
      } else {
        withDb = true
      }

      seenFlags.add(arg)
      continue
    }

    if (valueCrudFlags.has(arg)) {
      if (seenFlags.has(arg)) {
        throw usageError(`Duplicate option: ${arg}`)
      }

      const next = argv[i + 1]
      if (!next || next.startsWith('-')) {
        throw usageError(`Missing value for ${arg}`)
      }

      if (arg === '--domain') {
        domain = next
      } else if (arg === '--entity') {
        entity = next
      } else {
        plural = next
      }

      seenFlags.add(arg)
      i += 1
      continue
    }

    if (arg.startsWith('-')) {
      throw usageError(`Unknown option: ${arg}`)
    }

    throw usageError(`Unexpected argument: ${arg}`)
  }

  if (!domain || !entity) {
    throw usageError('Missing required options: --domain and --entity')
  }

  return { domain, entity, plural, dryRun, force, withDb }
}
