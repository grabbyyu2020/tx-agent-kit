import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseYoutubeVideoId } from './youtube-url.js'

const ID = 'dQw4w9WgXcQ'

describe('parseYoutubeVideoId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}`],
    [`http://youtube.com/watch?v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`],
    [`https://www.youtube.com/watch?v=${ID}&list=PL1234567890`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube.com/embed/${ID}?start=10`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abcdef&t=3`],
    [`youtube.com/watch?v=${ID}`],
    [`  https://youtu.be/${ID}  `],
    [`https://WWW.YouTube.com/watch?v=${ID}`]
  ])('accepts %s [INV-SHADOW-002]', (url) => {
    expect(parseYoutubeVideoId(url)).toEqual(Option.some(ID))
  })

  it('accepts ids containing - and _ [INV-SHADOW-002]', () => {
    expect(parseYoutubeVideoId('https://youtu.be/a-b_c-d_e-f')).toEqual(Option.some('a-b_c-d_e-f'))
  })

  it.each([
    ['other host', `https://vimeo.com/watch?v=${ID}`],
    ['lookalike host', `https://youtube.com.evil.com/watch?v=${ID}`],
    ['host suffix trick', `https://notyoutube.com/watch?v=${ID}`],
    ['music subdomain', `https://music.youtube.com/watch?v=${ID}`],
    ['playlist without v', 'https://www.youtube.com/playlist?list=PL1234567890'],
    ['watch without v', 'https://www.youtube.com/watch?list=PL1234567890'],
    ['id too short', 'https://youtu.be/dQw4w9WgXc'],
    ['id too long', 'https://youtu.be/dQw4w9WgXcQQ'],
    ['v too long', 'https://www.youtube.com/watch?v=dQw4w9WgXcQQ'],
    ['illegal character', 'https://youtu.be/dQw4w9WgX$Q'],
    ['shorts without id', 'https://www.youtube.com/shorts/'],
    ['channel page', 'https://www.youtube.com/@somechannel'],
    ['extra path segment', `https://www.youtube.com/embed/${ID}/extra`],
    ['non-http scheme', `ftp://youtube.com/watch?v=${ID}`],
    ['javascript scheme', `javascript:alert('${ID}')`],
    ['not a url', 'hello world'],
    ['empty', '']
  ])('rejects %s [INV-SHADOW-002]', (_label, url) => {
    expect(Option.isNone(parseYoutubeVideoId(url))).toBe(true)
  })
})
