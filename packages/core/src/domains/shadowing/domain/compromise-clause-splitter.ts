import nlp from 'compromise'
import type { ClauseSplitter } from './practice-segments.js'

/**
 * Clause splitter backed by `compromise`; mostly splits at clause punctuation such as commas.
 * Kept out of `practice-segments.ts` so the NLP library loads only when an import builds segments.
 */
export const compromiseClauseSplitter: ClauseSplitter = (text) => {
  const out: unknown = nlp(text).clauses().out('array')
  return Array.isArray(out) ? out.filter((clause): clause is string => typeof clause === 'string') : [text]
}
