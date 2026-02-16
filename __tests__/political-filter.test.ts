/**
 * Political Content Filter Tests
 *
 * Comprehensive regression tests for the political content filter module.
 * Ensures political content is correctly identified and blocked across
 * direct text, embedded quotes, link cards, and thread contexts.
 *
 * @module political-filter-tests
 */

import { describe, it, expect } from 'vitest'
import {
  isPoliticalContent,
  extractEmbeddedText,
  isPostPolitical,
} from '../lib/workflows/modules/political-filter'

// ---------------------------------------------------------------------------
// 1. isPoliticalContent - keyword detection
// ---------------------------------------------------------------------------

describe('isPoliticalContent - keyword detection', () => {
  describe('English political keywords by category', () => {
    it('catches US politics - people', () => {
      expect(isPoliticalContent('Trump is trending again')).toBe(true)
      expect(isPoliticalContent('Biden signed the bill')).toBe(true)
      expect(isPoliticalContent('Harris spoke at the rally')).toBe(true)
      expect(isPoliticalContent('DeSantis announced his plan')).toBe(true)
      expect(isPoliticalContent('Obama gave a speech')).toBe(true)
      expect(isPoliticalContent('MAGA supporters gathered')).toBe(true)
      expect(isPoliticalContent('The first lady attended the event')).toBe(true)
    })

    it('catches US politics - parties/ideology', () => {
      expect(isPoliticalContent('The Democrat position on this')).toBe(true)
      expect(isPoliticalContent('Republican lawmakers voted')).toBe(true)
      expect(isPoliticalContent('The GOP is divided')).toBe(true)
      expect(isPoliticalContent('Liberal media coverage')).toBe(true)
      expect(isPoliticalContent('Conservative values matter')).toBe(true)
      expect(isPoliticalContent('Left-wing activists protested')).toBe(true)
      expect(isPoliticalContent('Right-wing media reported')).toBe(true)
      expect(isPoliticalContent('The far-right movement')).toBe(true)
      expect(isPoliticalContent('Far-left policies proposed')).toBe(true)
    })

    it('catches US politics - institutions', () => {
      expect(isPoliticalContent('Congress passed a new law')).toBe(true)
      expect(isPoliticalContent('The Senate hearing began')).toBe(true)
      expect(isPoliticalContent('Protesters at the Capitol')).toBe(true)
      expect(isPoliticalContent('White House press briefing')).toBe(true)
      expect(isPoliticalContent('Supreme Court ruling')).toBe(true)
      expect(isPoliticalContent('DOJ investigation ongoing')).toBe(true)
      expect(isPoliticalContent('Department of Justice report')).toBe(true)
      expect(isPoliticalContent('The attorney general stated')).toBe(true)
    })

    it('catches elections keywords', () => {
      expect(isPoliticalContent('The election results are in')).toBe(true)
      expect(isPoliticalContent('Go out and vote!')).toBe(true)
      expect(isPoliticalContent('Ballot counting continues')).toBe(true)
      expect(isPoliticalContent('Polling shows a tight race')).toBe(true)
      expect(isPoliticalContent('The primary race is heating up')).toBe(true)
      expect(isPoliticalContent('Iowa caucus results')).toBe(true)
      expect(isPoliticalContent('Electoral college votes')).toBe(true)
      expect(isPoliticalContent('Campaign donations surged')).toBe(true)
      expect(isPoliticalContent('Inauguration day ceremony')).toBe(true)
      expect(isPoliticalContent('Impeach the president')).toBe(true)
    })

    it('catches hot-button issue keywords', () => {
      expect(isPoliticalContent('The abortion debate continues')).toBe(true)
      expect(isPoliticalContent('Pro-life rally downtown')).toBe(true)
      expect(isPoliticalContent('Pro-choice advocates marched')).toBe(true)
      expect(isPoliticalContent('Gun control legislation')).toBe(true)
      expect(isPoliticalContent('Second amendment rights')).toBe(true)
      expect(isPoliticalContent('2nd amendment supporters')).toBe(true)
      expect(isPoliticalContent('Immigration reform needed')).toBe(true)
      expect(isPoliticalContent('Build the border wall')).toBe(true)
      expect(isPoliticalContent('Mass deportation planned')).toBe(true)
      expect(isPoliticalContent('Refugee crisis deepens')).toBe(true)
      expect(isPoliticalContent('Asylum seeker numbers rise')).toBe(true)
      expect(isPoliticalContent('Climate change denial is rampant')).toBe(true)
      expect(isPoliticalContent('The woke agenda')).toBe(true)
      expect(isPoliticalContent('Anti-woke policies enacted')).toBe(true)
      expect(isPoliticalContent('DEI programs cut')).toBe(true)
      expect(isPoliticalContent('Critical race theory in schools')).toBe(true)
      expect(isPoliticalContent('CRT curriculum debate')).toBe(true)
      expect(isPoliticalContent('Defund police movement')).toBe(true)
      expect(isPoliticalContent('BLM protests erupted')).toBe(true)
      expect(isPoliticalContent('Antifa clashed with police')).toBe(true)
      expect(isPoliticalContent('Proud Boys marched')).toBe(true)
    })

    it('catches international politics keywords', () => {
      expect(isPoliticalContent('Putin ordered the attack')).toBe(true)
      expect(isPoliticalContent('Zelensky addressed the nation')).toBe(true)
      expect(isPoliticalContent('Xi Jinping met with leaders')).toBe(true)
      expect(isPoliticalContent('Netanyahu responded to criticism')).toBe(true)
      expect(isPoliticalContent('Gaza conflict escalates')).toBe(true)
      expect(isPoliticalContent('Palestine conflict updates')).toBe(true)
      expect(isPoliticalContent('Sanctions imposed on Russia')).toBe(true)
      expect(isPoliticalContent('NATO expansion discussed')).toBe(true)
    })

    it('catches general political terms', () => {
      expect(isPoliticalContent('Partisan divide deepens')).toBe(true)
      expect(isPoliticalContent('Bipartisan agreement reached')).toBe(true)
      expect(isPoliticalContent('Lobbyist influence on policy')).toBe(true)
      expect(isPoliticalContent('This is too political')).toBe(true)
      expect(isPoliticalContent('Another politician scandal')).toBe(true)
      expect(isPoliticalContent('New legislation proposed')).toBe(true)
      expect(isPoliticalContent('Government shutdown looms')).toBe(true)
      expect(isPoliticalContent('Filibuster blocks progress')).toBe(true)
      expect(isPoliticalContent('Gerrymandering distorts maps')).toBe(true)
      expect(isPoliticalContent('Epstein files released')).toBe(true)
      expect(isPoliticalContent('Classified documents found')).toBe(true)
    })
  })

  describe('Korean political keywords', () => {
    it('catches Korean political terms', () => {
      expect(isPoliticalContent('정치적인 상황이 심각합니다')).toBe(true)
      expect(isPoliticalContent('대통령이 발표했습니다')).toBe(true)
      expect(isPoliticalContent('국회에서 논의 중입니다')).toBe(true)
      expect(isPoliticalContent('여당의 입장은')).toBe(true)
      expect(isPoliticalContent('야당이 반대합니다')).toBe(true)
      expect(isPoliticalContent('보수 성향의 의견')).toBe(true)
      expect(isPoliticalContent('진보 세력이 주장합니다')).toBe(true)
      expect(isPoliticalContent('탄핵 소추가 진행됩니다')).toBe(true)
      expect(isPoliticalContent('선거가 다가옵니다')).toBe(true)
      expect(isPoliticalContent('투표하세요!')).toBe(true)
      expect(isPoliticalContent('국민의힘 대표가 발언했습니다')).toBe(true)
      expect(isPoliticalContent('더불어민주당 성명서')).toBe(true)
      expect(isPoliticalContent('민주당의 정책')).toBe(true)
      expect(isPoliticalContent('좌파 정책 비판')).toBe(true)
      expect(isPoliticalContent('우파 진영에서')).toBe(true)
      expect(isPoliticalContent('빨갱이라고 부르지 마세요')).toBe(true)
      expect(isPoliticalContent('수꼴 논란')).toBe(true)
    })
  })

  describe('case-insensitive matching', () => {
    it('catches keywords regardless of case', () => {
      expect(isPoliticalContent('TRUMP is back')).toBe(true)
      expect(isPoliticalContent('trump is back')).toBe(true)
      expect(isPoliticalContent('Trump is back')).toBe(true)
      expect(isPoliticalContent('tRuMp is back')).toBe(true)
      expect(isPoliticalContent('MAGA rally')).toBe(true)
      expect(isPoliticalContent('maga rally')).toBe(true)
      expect(isPoliticalContent('REPUBLICAN party')).toBe(true)
      expect(isPoliticalContent('Republican party')).toBe(true)
    })
  })

  describe('keywords in longer text', () => {
    it('catches keywords embedded in longer sentences', () => {
      expect(isPoliticalContent(
        'I was watching the news and they were talking about how Trump said something controversial again'
      )).toBe(true)
      expect(isPoliticalContent(
        'The latest polling data shows a significant shift in voter sentiment across swing states'
      )).toBe(true)
      expect(isPoliticalContent(
        'Have you seen the new documentary about the first lady? It is getting terrible reviews'
      )).toBe(true)
    })
  })

  describe('non-political content passes through', () => {
    it('does NOT flag meme content', () => {
      expect(isPoliticalContent('This cat meme is hilarious')).toBe(false)
      expect(isPoliticalContent('doge to the moon')).toBe(false)
      expect(isPoliticalContent('vibing cat energy today')).toBe(false)
      expect(isPoliticalContent('me trying to adult today')).toBe(false)
    })

    it('does NOT flag food content', () => {
      expect(isPoliticalContent('Just made the best pasta ever')).toBe(false)
      expect(isPoliticalContent('This ramen is incredible')).toBe(false)
      expect(isPoliticalContent('Cooking spaghetti for dinner')).toBe(false)
    })

    it('does NOT flag pet/animal content', () => {
      expect(isPoliticalContent('My cat is sleeping on my keyboard again')).toBe(false)
      expect(isPoliticalContent('Look at this cute puppy!')).toBe(false)
      expect(isPoliticalContent('The dog park was fun today')).toBe(false)
    })

    it('does NOT flag generic everyday content', () => {
      expect(isPoliticalContent('Good morning everyone!')).toBe(false)
      expect(isPoliticalContent('Just finished a great book')).toBe(false)
      expect(isPoliticalContent('The weather is beautiful today')).toBe(false)
      expect(isPoliticalContent('Working from home is nice')).toBe(false)
      expect(isPoliticalContent('New album dropped and it slaps')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. isPoliticalContent - edge cases
// ---------------------------------------------------------------------------

describe('isPoliticalContent - edge cases', () => {
  it('returns false for empty string', () => {
    expect(isPoliticalContent('')).toBe(false)
  })

  it('returns false for null/undefined (via falsy check)', () => {
    expect(isPoliticalContent(null as unknown as string)).toBe(false)
    expect(isPoliticalContent(undefined as unknown as string)).toBe(false)
  })

  it('handles very long text', () => {
    const longText = 'a'.repeat(10000) + ' trump ' + 'b'.repeat(10000)
    expect(isPoliticalContent(longText)).toBe(true)

    const longSafeText = 'just a regular day '.repeat(1000)
    expect(isPoliticalContent(longSafeText)).toBe(false)
  })

  it('catches keywords with surrounding punctuation', () => {
    expect(isPoliticalContent('"trump" is trending')).toBe(true)
    expect(isPoliticalContent('(biden) signed it')).toBe(true)
    expect(isPoliticalContent('trump!')).toBe(true)
    expect(isPoliticalContent('trump?')).toBe(true)
    expect(isPoliticalContent('trump.')).toBe(true)
    expect(isPoliticalContent('#trump')).toBe(true)
    expect(isPoliticalContent('@trump')).toBe(true)
    expect(isPoliticalContent('...trump...')).toBe(true)
  })

  it('catches keywords in URLs', () => {
    expect(isPoliticalContent('https://example.com/trump-rally-recap')).toBe(true)
    expect(isPoliticalContent('Check out https://news.com/biden-policy-update')).toBe(true)
  })

  it('catches keywords that are substrings in compound words', () => {
    // Note: the current filter uses .includes() so these WILL match
    expect(isPoliticalContent('trumpism is growing')).toBe(true)
    expect(isPoliticalContent('bidenomics explained')).toBe(true)
    expect(isPoliticalContent('anti-immigration rally')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. extractEmbeddedText
// ---------------------------------------------------------------------------

describe('extractEmbeddedText', () => {
  it('returns empty string for null/undefined embed', () => {
    expect(extractEmbeddedText(null)).toBe('')
    expect(extractEmbeddedText(undefined)).toBe('')
  })

  it('returns empty string for embed without recognized $type', () => {
    expect(extractEmbeddedText({ $type: 'unknown.type' })).toBe('')
  })

  it('extracts text from record embed (quote post - view type)', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        value: {
          text: 'This is the quoted post text about trump',
        },
      },
    }
    expect(extractEmbeddedText(embed)).toBe('This is the quoted post text about trump')
  })

  it('extracts text from record embed (quote post - non-view type)', () => {
    const embed = {
      $type: 'app.bsky.embed.record',
      record: {
        value: {
          text: 'Quoted text here',
        },
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Quoted text here')
  })

  it('extracts text from record embed where value is directly on record', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        text: 'Direct record text',
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Direct record text')
  })

  it('extracts text from external link embed (view type)', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Breaking News Title',
        description: 'A description of the link content',
        uri: 'https://example.com/article',
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Breaking News Title A description of the link content')
  })

  it('extracts text from external link embed (non-view type)', () => {
    const embed = {
      $type: 'app.bsky.embed.external',
      external: {
        title: 'Article Title',
        description: 'Article description here',
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Article Title Article description here')
  })

  it('extracts text from recordWithMedia embed', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: {
        $type: 'app.bsky.embed.record#view',
        record: {
          value: {
            text: 'Quoted text with media',
          },
        },
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Quoted text with media')
  })

  it('extracts text from recordWithMedia embed (non-view type)', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        $type: 'app.bsky.embed.record',
        record: {
          value: {
            text: 'Media quote text',
          },
        },
      },
    }
    expect(extractEmbeddedText(embed)).toBe('Media quote text')
  })

  it('handles nested embeds (quote of a quote)', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        value: {
          text: 'Outer quote text',
          embeds: [
            {
              $type: 'app.bsky.embed.record#view',
              record: {
                value: {
                  text: 'Inner quote text',
                },
              },
            },
          ],
        },
      },
    }
    const result = extractEmbeddedText(embed)
    expect(result).toContain('Outer quote text')
    expect(result).toContain('Inner quote text')
  })

  it('handles nested link card in quoted post', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        value: {
          text: 'Check this article',
          embed: {
            $type: 'app.bsky.embed.external#view',
            external: {
              title: 'Political Article Title',
              description: 'Description of a political article',
            },
          },
        },
      },
    }
    const result = extractEmbeddedText(embed)
    expect(result).toContain('Check this article')
    expect(result).toContain('Political Article Title')
    expect(result).toContain('Description of a political article')
  })

  it('handles missing external fields gracefully', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        uri: 'https://example.com',
      },
    }
    expect(extractEmbeddedText(embed)).toBe('')
  })

  it('handles missing record fields gracefully', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: undefined,
    }
    expect(extractEmbeddedText(embed as any)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 4. isPostPolitical
// ---------------------------------------------------------------------------

describe('isPostPolitical', () => {
  it('detects political content in direct post text', () => {
    expect(isPostPolitical('Trump announced new policies today')).toBe(true)
    expect(isPostPolitical('The election results are shocking')).toBe(true)
  })

  it('detects political content in embedded quote post', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        value: {
          text: 'Biden signed an executive order',
        },
      },
    }
    expect(isPostPolitical('Look at this!', embed)).toBe(true)
  })

  it('detects political content in link card title', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Melania Suffers Woeful Weekend at the Box Office',
        description: 'The documentary about the first lady continues to underperform.',
        uri: 'https://example.com/article',
      },
    }
    expect(isPostPolitical('Wow, box office news', embed)).toBe(true)
  })

  it('detects political content in link card description only', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Box Office Numbers This Weekend',
        description: 'Trump era documentary fails to attract viewers',
        uri: 'https://example.com/article',
      },
    }
    expect(isPostPolitical('Weekend movie numbers', embed)).toBe(true)
  })

  it('passes non-political post with non-political embed', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Top 10 Cat Videos of 2025',
        description: 'The cutest cat compilations you need to watch',
        uri: 'https://example.com/cats',
      },
    }
    expect(isPostPolitical('Check out these adorable cats!', embed)).toBe(false)
  })

  it('passes non-political post with no embed', () => {
    expect(isPostPolitical('Just having a great day!')).toBe(false)
    expect(isPostPolitical('My cat knocked over my coffee')).toBe(false)
  })

  it('passes non-political post with null embed', () => {
    expect(isPostPolitical('Beautiful sunset today', null)).toBe(false)
  })

  it('catches political content in recordWithMedia embed', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: {
        $type: 'app.bsky.embed.record#view',
        record: {
          value: {
            text: 'Congress voted on the new bill',
          },
        },
      },
    }
    expect(isPostPolitical('Breaking news!', embed)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Integration: reply context filtering
// ---------------------------------------------------------------------------

describe('Integration: reply context filtering', () => {
  it('non-political reply text but political parent text should be caught', () => {
    // In a real scenario, the filter checks both the reply and parent separately.
    // Here we verify that if you combine parent + reply text, political content is caught.
    const parentText = 'Trump just signed a new executive order'
    const replyText = 'Interesting, I did not see that coming!'

    // The parent text alone is political
    expect(isPoliticalContent(parentText)).toBe(true)
    // The reply text alone is not political
    expect(isPoliticalContent(replyText)).toBe(false)
    // Combined (as would happen in thread-aware filtering), it should be caught
    expect(isPoliticalContent(`${parentText} ${replyText}`)).toBe(true)
  })

  it('checking thread root for political content works', () => {
    const rootText = 'The election was a disaster for the Republican party'
    const midText = 'I agree, it was really something'
    const leafText = 'What a time to be alive!'

    expect(isPoliticalContent(rootText)).toBe(true)
    expect(isPoliticalContent(midText)).toBe(false)
    expect(isPoliticalContent(leafText)).toBe(false)
    // If the system combines root context, it should catch it
    expect(isPoliticalContent(`${rootText} ${midText} ${leafText}`)).toBe(true)
  })

  it('non-political thread passes through entirely', () => {
    const rootText = 'Just made the best cookies ever!'
    const replyText = 'Recipe please!'
    const reply2Text = 'I need to try these too'

    expect(isPoliticalContent(rootText)).toBe(false)
    expect(isPoliticalContent(replyText)).toBe(false)
    expect(isPoliticalContent(reply2Text)).toBe(false)
    expect(isPoliticalContent(`${rootText} ${replyText} ${reply2Text}`)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Regression tests for specific incidents
// ---------------------------------------------------------------------------

describe('Regression: specific incidents', () => {
  it('catches "The first lady\'s documentary continues to plummet"', () => {
    expect(isPoliticalContent(
      "The first lady's documentary continues to plummet"
    )).toBe(true)
  })

  it('catches "Melania Suffers Woeful Weekend at the Box Office" via link card', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Melania Suffers Woeful Weekend at the Box Office',
        description: 'The first lady documentary earned only $2M in its opening weekend.',
        uri: 'https://example.com/melania-box-office',
      },
    }
    // The post text itself might be innocuous, but the link card is political
    expect(isPostPolitical('Box office update', embed)).toBe(true)
  })

  it('catches seemingly innocent reply to a political post context', () => {
    // The reply text alone is not political
    const replyText = 'Box office woes? Maybe she should stick to making cookies'
    expect(isPoliticalContent(replyText)).toBe(false)

    // But the parent post it's replying to is political
    const parentText = "The first lady's documentary continues to plummet at the box office"
    expect(isPoliticalContent(parentText)).toBe(true)

    // Combined parent+reply check catches it
    expect(isPoliticalContent(`${parentText} ${replyText}`)).toBe(true)
  })

  it('does NOT flag normal meme content', () => {
    expect(isPoliticalContent('This doge meme just hits different')).toBe(false)
    expect(isPoliticalContent('When the vibes are immaculate')).toBe(false)
    expect(isPoliticalContent('no thoughts, just vibes')).toBe(false)
    expect(isPoliticalContent('me when the coffee kicks in')).toBe(false)
  })

  it('KNOWN FALSE POSITIVE: "woke up" triggers "woke" keyword', () => {
    // "woke" is a political keyword, but "woke up" is everyday language.
    // The current filter uses substring matching so "woke up" is a false positive.
    // This test documents the known issue.
    expect(isPoliticalContent('POV: you just woke up and chose chaos')).toBe(true) // false positive
    expect(isPoliticalContent('I just woke up feeling great')).toBe(true) // false positive
  })

  it('does NOT flag cat/dog/food content', () => {
    expect(isPoliticalContent('My cat just learned how to open doors')).toBe(false)
    expect(isPoliticalContent('Puppy tax! Here is my new golden retriever')).toBe(false)
    expect(isPoliticalContent('Made homemade ramen today and it was amazing')).toBe(false)
    expect(isPoliticalContent('Best tacos I have ever had')).toBe(false)
    expect(isPoliticalContent('The dog stole my sandwich again')).toBe(false)
  })

  it('catches "Melania" in post text since it contains "first lady" context', () => {
    // "Melania" by itself is not a keyword, but context involving "first lady" is
    expect(isPoliticalContent(
      'Melania appears at the White House event'
    )).toBe(true) // "white house" matches
  })

  it('catches political link card even with benign post text', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: {
        title: 'Senate Votes to Block New Immigration Bill',
        description: 'Republican senators filibuster the legislation',
        uri: 'https://example.com/senate-vote',
      },
    }
    expect(isPostPolitical('Interesting read', embed)).toBe(true)
  })

  it('catches political quote post even with benign outer text', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        value: {
          text: 'The impeachment proceedings are a joke',
        },
      },
    }
    expect(isPostPolitical('Wow, look at this take', embed)).toBe(true)
  })
})
