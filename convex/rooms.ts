import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { answer, createGame, nextDeadline, pickHero, timeout, viewFor } from './game/engine'
import type { Answer, Game } from './game/engine'
import { HERO_IDS, MAX_PLAYERS, MIN_PLAYERS } from './game/defs'
import type { HeroId } from './game/defs'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomId(len: number, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function cleanName(name: string) {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!n) throw new Error('Enter a name first.')
  return n
}

function memberOf(room: Doc<'rooms'>, token: string) {
  return room.members.find((m) => m.token === token) ?? null
}

async function getRoom(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId)
  if (!room) throw new Error('This room no longer exists.')
  return room
}

/** Persist a changed game and make sure its next deadline is scheduled. */
async function saveGame(ctx: MutationCtx, room: Doc<'rooms'>, game: Game) {
  const version = room.version + 1
  await ctx.db.patch(room._id, {
    game,
    version,
    status: game.phase === 'over' ? 'over' : 'playing',
  })
  const d = nextDeadline(game)
  if (d) {
    await ctx.scheduler.runAt(d.at, internal.rooms.tick, { roomId: room._id, promptId: d.promptId ?? -1 })
  }
}

export const create = mutation({
  args: { token: v.string(), name: v.string() },
  handler: async (ctx, { token, name }) => {
    const n = cleanName(name)
    let code = ''
    for (let i = 0; i < 20; i++) {
      code = randomId(5, CODE_CHARS)
      const existing = await ctx.db
        .query('rooms')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (!existing) break
    }
    const pid = randomId(10)
    await ctx.db.insert('rooms', {
      code,
      hostPid: pid,
      status: 'lobby',
      members: [{ pid, token, name: n }],
      game: null,
      version: 0,
      createdAt: Date.now(),
    })
    return code
  },
})

export const join = mutation({
  args: { code: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, { code, token, name }) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', code.toUpperCase().trim()))
      .first()
    if (!room) throw new Error('No room with that code. Check the code and try again.')
    const n = cleanName(name)
    const me = memberOf(room, token)
    if (me) {
      if (me.name !== n && room.status === 'lobby') {
        await ctx.db.patch(room._id, { members: room.members.map((m) => (m.token === token ? { ...m, name: n } : m)) })
      }
      return { code: room.code, joined: true }
    }
    if (room.status !== 'lobby') return { code: room.code, joined: false }
    if (room.members.length >= MAX_PLAYERS) throw new Error(`This room is full (${MAX_PLAYERS} players).`)
    await ctx.db.patch(room._id, { members: [...room.members, { pid: randomId(10), token, name: n }] })
    return { code: room.code, joined: true }
  },
})

export const leave = mutation({
  args: { roomId: v.id('rooms'), token: v.string() },
  handler: async (ctx, { roomId, token }) => {
    const room = await getRoom(ctx, roomId)
    const me = memberOf(room, token)
    if (!me || room.status !== 'lobby') return
    const members = room.members.filter((m) => m.token !== token)
    await ctx.db.patch(room._id, {
      members,
      hostPid: room.hostPid === me.pid && members.length ? members[0].pid : room.hostPid,
    })
  },
})

export const get = query({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', code.toUpperCase().trim()))
      .first()
    if (!room) return null
    const me = memberOf(room, token)
    return {
      roomId: room._id,
      code: room.code,
      status: room.status,
      hostPid: room.hostPid,
      members: room.members.map((m) => ({ pid: m.pid, name: m.name })),
      me: me?.pid ?? null,
      version: room.version,
      view: room.game ? viewFor(room.game as Game, me?.pid ?? null) : null,
    }
  },
})

export const start = mutation({
  args: { roomId: v.id('rooms'), token: v.string() },
  handler: async (ctx, { roomId, token }) => {
    const room = await getRoom(ctx, roomId)
    const me = memberOf(room, token)
    if (!me || me.pid !== room.hostPid) throw new Error('Only the host can start the game.')
    if (room.status === 'playing') throw new Error('The game has already started.')
    if (room.members.length < MIN_PLAYERS) throw new Error(`You need at least ${MIN_PLAYERS} players.`)
    const game = createGame(
      room.members.map((m) => ({ id: m.pid, name: m.name })),
      Date.now(),
    )
    await saveGame(ctx, room, game)
  },
})

export const backToLobby = mutation({
  args: { roomId: v.id('rooms'), token: v.string() },
  handler: async (ctx, { roomId, token }) => {
    const room = await getRoom(ctx, roomId)
    const me = memberOf(room, token)
    if (!me || me.pid !== room.hostPid) throw new Error('Only the host can do that.')
    await ctx.db.patch(room._id, { status: 'lobby', game: null, version: room.version + 1 })
  },
})

export const chooseHero = mutation({
  args: { roomId: v.id('rooms'), token: v.string(), hero: v.string() },
  handler: async (ctx, { roomId, token, hero }) => {
    const room = await getRoom(ctx, roomId)
    const me = memberOf(room, token)
    if (!me || !room.game) throw new Error('You are not playing in this room.')
    if (!HERO_IDS.includes(hero as HeroId)) throw new Error('Unknown hero.')
    const game = room.game as Game
    const err = pickHero(game, me.pid, hero as HeroId, Date.now())
    if (err) throw new Error(err)
    await saveGame(ctx, room, game)
  },
})

const answerValidator = v.object({
  pass: v.optional(v.boolean()),
  action: v.optional(v.union(v.literal('card'), v.literal('skill'), v.literal('end'))),
  cards: v.optional(v.array(v.number())),
  as: v.optional(v.string()),
  targets: v.optional(v.array(v.string())),
  skill: v.optional(v.string()),
  armor: v.optional(v.boolean()),
  pick: v.optional(v.union(v.literal('hand'), v.number())),
  choice: v.optional(v.string()),
})

export const act = mutation({
  args: { roomId: v.id('rooms'), token: v.string(), promptId: v.number(), answer: answerValidator },
  handler: async (ctx, args) => {
    const room = await getRoom(ctx, args.roomId)
    const me = memberOf(room, args.token)
    if (!me || !room.game) throw new Error('You are not playing in this room.')
    const game = room.game as Game
    const err = answer(game, me.pid, args.promptId, args.answer as Answer, Date.now())
    if (err) return { error: err }
    await saveGame(ctx, room, game)
    return { error: null }
  },
})

export const tick = internalMutation({
  args: { roomId: v.id('rooms'), promptId: v.number() },
  handler: async (ctx, { roomId, promptId }) => {
    const room = await ctx.db.get(roomId)
    if (!room || !room.game) return
    const game = room.game as Game
    const changed = timeout(game, promptId < 0 ? null : promptId, Date.now())
    if (changed) await saveGame(ctx, room, game)
  },
})
