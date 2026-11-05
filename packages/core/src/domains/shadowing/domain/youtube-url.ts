import type { Brand } from 'effect'
import { Option } from 'effect'

/** An 11-character YouTube video id (`^[A-Za-z0-9_-]{11}$`). */
export type YoutubeVideoId = string & Brand.Brand<'YoutubeVideoId'>

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export const isYoutubeVideoId = (value: string): value is YoutubeVideoId => YOUTUBE_VIDEO_ID.test(value)

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const shortHosts = new Set(['youtu.be', 'www.youtu.be'])
const idPathPrefixes = new Set(['shorts', 'embed'])

const candidateId = (url: URL): Option.Option<string> => {
  const segments = url.pathname.split('/').filter((s) => s.length > 0)

  if (shortHosts.has(url.hostname)) {
    return segments.length === 1 ? Option.fromNullable(segments[0]) : Option.none()
  }
  if (!youtubeHosts.has(url.hostname)) {
    return Option.none()
  }
  if (segments.length === 1 && segments[0] === 'watch') {
    return Option.fromNullable(url.searchParams.get('v'))
  }
  if (segments.length === 2 && idPathPrefixes.has(segments[0] ?? '')) {
    return Option.fromNullable(segments[1])
  }
  return Option.none()
}

/**
 * Extract the video id from a YouTube watch, mobile, shorts, embed or youtu.be URL.
 * Extra query parameters are ignored; other hosts and malformed ids yield `None`.
 */
export const parseYoutubeVideoId = (input: string): Option.Option<YoutubeVideoId> => {
  const trimmed = input.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(withScheme)) {
    return Option.none()
  }
  const url = new URL(withScheme)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return Option.none()
  }
  return Option.filter(candidateId(url), isYoutubeVideoId)
}
