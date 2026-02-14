/**
 * Memory Prompt Builder
 *
 * Converts structured bot memory into prompt context for AI generation.
 * Target: 400-800 tokens of information-dense context.
 *
 * @module memory-prompt-builder
 */

import type { BotMemory } from '@/lib/agent/types/bot-memory'
import { getTopicsOnCooldown } from './bot-memory-service'

export function buildMemoryContext(memory: BotMemory): string {
  const sections: string[] = []

  if (memory.currentMood && memory.currentMood !== 'neutral') {
    sections.push(`CURRENT MOOD: ${memory.currentMood}`)
  }

  if (memory.narrativeArc) {
    sections.push(`YOUR STORY SO FAR: ${memory.narrativeArc}`)
  }

  if (memory.recentPosts.length > 0) {
    const digests = memory.recentPosts
      .slice(0, 10)
      .map(p => `- [${p.mood}] ${p.gist} (${relativeTime(p.postedAt)})`)
      .join('\n')
    sections.push(`YOUR RECENT POSTS (do NOT repeat):\n${digests}`)
  }

  const cooldownTopics = getTopicsOnCooldown(memory, 8)
  if (cooldownTopics.length > 0) {
    sections.push(
      `TOPICS ON COOLDOWN (posted recently, avoid):\n${cooldownTopics.join(', ')}`
    )
  }

  const activeThemes = memory.runningThemes.filter(t => t.status === 'active')
  if (activeThemes.length > 0) {
    const themes = activeThemes
      .map(t => `- "${t.description}" (${t.mentionCount} posts so far)`)
      .join('\n')
    sections.push(`YOUR RUNNING BITS (you can continue these):\n${themes}`)
  }

  if (memory.relationships.length > 0) {
    const rels = memory.relationships
      .slice(0, 8)
      .map(r => `- ${r.name}: ${r.sentiment} -- "${r.lastInteraction}"`)
      .join('\n')
    sections.push(`PEOPLE YOU KNOW:\n${rels}`)
  }

  if (memory.avoidList.length > 0) {
    sections.push(`DO NOT TALK ABOUT: ${memory.avoidList.join('; ')}`)
  }

  if (sections.length === 0) {
    return 'MEMORY: This is your first time posting. Make a strong first impression.'
  }

  return `YOUR MEMORY:\n${sections.join('\n\n')}`
}

function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime()
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
