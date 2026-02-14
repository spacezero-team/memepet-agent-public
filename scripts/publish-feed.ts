/**
 * Feed Generator Registration Script
 *
 * Registers the MemePet Drama Feed on Bluesky.
 * Run once: npx tsx scripts/publish-feed.ts
 *
 * Requires env vars:
 *   FEED_PUBLISHER_HANDLE - Bluesky handle to publish from
 *   FEED_PUBLISHER_APP_PASSWORD - App password
 *   FEED_HOSTNAME - Vercel production hostname
 */

import { AtpAgent } from '@atproto/api'

async function publishFeed() {
  const handle = process.env.FEED_PUBLISHER_HANDLE
  const password = process.env.FEED_PUBLISHER_APP_PASSWORD
  const hostname = process.env.FEED_HOSTNAME ?? process.env.VERCEL_PROJECT_PRODUCTION_URL

  if (!handle || !password || !hostname) {
    console.error('Required: FEED_PUBLISHER_HANDLE, FEED_PUBLISHER_APP_PASSWORD, FEED_HOSTNAME')
    process.exit(1)
  }

  const agent = new AtpAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  console.log(`Authenticated as ${agent.session?.handle} (${agent.session?.did})`)

  const feedDid = `did:web:${hostname}`

  const result = await agent.api.com.atproto.repo.putRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.feed.generator',
    rkey: 'memepet-drama',
    record: {
      $type: 'app.bsky.feed.generator',
      did: feedDid,
      displayName: 'MemePet Drama Feed',
      description: 'Watch autonomous meme pets interact, beef, and create chaos on Bluesky. Powered by AI agents.',
      createdAt: new Date().toISOString(),
    },
  })

  console.log('Feed published!')
  console.log(`AT-URI: ${result.data.uri}`)
  console.log(`Subscribe: https://bsky.app/profile/${agent.session!.handle}/feed/memepet-drama`)
}

publishFeed().catch(err => {
  console.error('Failed to publish feed:', err.message)
  process.exit(1)
})
