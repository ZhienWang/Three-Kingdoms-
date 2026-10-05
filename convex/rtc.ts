// Presence, WebRTC signalling and room chat.
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

async function member(ctx: QueryCtx, roomId: Id<'rooms'>, token: string) {
  const room = await ctx.db.get(roomId)
  if (!room) return null
  return room.members.find((m) => m.token === token) ?? null
}

export const heartbeat = mutation({
  args: { roomId: v.id('rooms'), token: v.string(), camera: v.boolean() },
  handler: async (ctx, { roomId, token, camera }) => {
    const me = await member(ctx, roomId, token)
    if (!me) return null
    const existing = await ctx.db
      .query('presence')
      .withIndex('by_room_pid', (q) => q.eq('roomId', roomId).eq('pid', me.pid))
      .first()
    const now = Date.now()
    if (existing) await ctx.db.patch(existing._id, { lastSeen: now, camera, name: me.name })
    else await ctx.db.insert('presence', { roomId, pid: me.pid, name: me.name, lastSeen: now, camera })
    return me.pid
  },
})

export const presence = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const rows = await ctx.db
      .query('presence')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect()
    return rows.map((r) => ({ pid: r.pid, name: r.name, lastSeen: r.lastSeen, camera: r.camera }))
  },
})

export const signal = mutation({
  args: {
    roomId: v.id('rooms'),
    token: v.string(),
    to: v.string(),
    kind: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, { roomId, token, to, kind, payload }) => {
    const me = await member(ctx, roomId, token)
    if (!me) throw new Error('Not in this room.')
    if (payload.length > 20_000) throw new Error('Signal too large.')
    await ctx.db.insert('signals', { roomId, from: me.pid, to, kind, payload, createdAt: Date.now() })
  },
})

export const inbox = query({
  args: { roomId: v.id('rooms'), token: v.string() },
  handler: async (ctx, { roomId, token }) => {
    const me = await member(ctx, roomId, token)
    if (!me) return []
    const rows = await ctx.db
      .query('signals')
      .withIndex('by_room_to', (q) => q.eq('roomId', roomId).eq('to', me.pid))
      .take(200)
    return rows.map((r) => ({ id: r._id, from: r.from, kind: r.kind, payload: r.payload, createdAt: r.createdAt }))
  },
})

export const ack = mutation({
  args: { roomId: v.id('rooms'), token: v.string(), ids: v.array(v.id('signals')) },
  handler: async (ctx, { roomId, token, ids }) => {
    const me = await member(ctx, roomId, token)
    if (!me) return
    for (const id of ids) {
      const s = await ctx.db.get(id)
      if (s && s.to === me.pid && s.roomId === roomId) await ctx.db.delete(id)
    }
  },
})

export const sendChat = mutation({
  args: { roomId: v.id('rooms'), token: v.string(), text: v.string() },
  handler: async (ctx, { roomId, token, text }) => {
    const me = await member(ctx, roomId, token)
    if (!me) throw new Error('Join the room to chat.')
    const t = text.trim().slice(0, 300)
    if (!t) return
    await ctx.db.insert('chat', { roomId, pid: me.pid, name: me.name, text: t, createdAt: Date.now() })
  },
})

export const chat = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const rows = await ctx.db
      .query('chat')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .order('desc')
      .take(60)
    return rows.reverse().map((r) => ({ id: r._id, pid: r.pid, name: r.name, text: r.text, at: r.createdAt }))
  },
})
