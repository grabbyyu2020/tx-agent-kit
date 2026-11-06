import { internalError, type CoreError } from '../../../errors.js'

export const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)
