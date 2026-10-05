import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,

  rooms: defineTable({
    code: v.string(),
    hostPid: v.string(),
    status: v.union(v.literal('lobby'), v.literal('playing'), v.literal('over')),
    members: v.array(
      v.object({
        pid: v.string(),
        token: v.string(),
        name: v.string(),
      }),
    ),
    // Serialised engine state (see convex/game/engine.ts). Null in the lobby.
    game: v.union(v.null(), v.any()),
    version: v.number(),
    createdAt: v.number(),
  }).index('by_code', ['code']),

  presence: defineTable({
    roomId: v.id('rooms'),
    pid: v.string(),
    name: v.string(),
    lastSeen: v.number(),
    camera: v.boolean(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_pid', ['roomId', 'pid']),

  // WebRTC signalling mailbox: offers, answers and ICE candidates between peers.
  signals: defineTable({
    roomId: v.id('rooms'),
    from: v.string(),
    to: v.string(),
    kind: v.string(),
    payload: v.string(),
    createdAt: v.number(),
  }).index('by_room_to', ['roomId', 'to']),

  chat: defineTable({
    roomId: v.id('rooms'),
    pid: v.string(),
    name: v.string(),
    text: v.string(),
    createdAt: v.number(),
  }).index('by_room', ['roomId']),
})
