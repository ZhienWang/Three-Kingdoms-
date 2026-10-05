// Live video between everyone in a room: a WebRTC mesh signalled through Convex.
//
// For each pair of players the one with the smaller id is the caller. The
// caller adds audio+video transceivers and sends an offer; the callee answers.
// Camera/mic changes use replaceTrack / track.enabled, so no renegotiation is
// ever needed after the first handshake.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

const PRESENCE_FRESH_MS = 25_000
const HEARTBEAT_MS = 8_000

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]
  const env = (import.meta as any).env ?? {}
  if (env.VITE_TURN_URL) {
    servers.push({
      urls: String(env.VITE_TURN_URL).split(',').map((s: string) => s.trim()),
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    })
  }
  return servers
}

interface Peer {
  pc: RTCPeerConnection
  cid: string
  caller: boolean
  pendingIce: RTCIceCandidateInit[]
  stream: MediaStream
}

export type PeerStatus = 'connecting' | 'connected' | 'failed'

export function useVideoMesh(roomId: Id<'rooms'> | null, token: string | null, me: string | null) {
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [remote, setRemote] = useState<Record<string, MediaStream>>({})
  const [status, setStatus] = useState<Record<string, PeerStatus>>({})
  const peers = useRef(new Map<string, Peer>())
  const localRef = useRef<MediaStream | null>(null)
  const processed = useRef(new Set<string>())
  const mountedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())

  const heartbeat = useMutation(api.rtc.heartbeat)
  const sendSignal = useMutation(api.rtc.signal)
  const ack = useMutation(api.rtc.ack)
  const presence = useQuery(api.rtc.presence, roomId ? { roomId } : 'skip')
  const inbox = useQuery(api.rtc.inbox, roomId && token ? { roomId, token } : 'skip')

  // Heartbeat so others know we're here (and whether our camera is on).
  useEffect(() => {
    if (!roomId || !token) return
    const beat = () => heartbeat({ roomId, token, camera: camOn }).catch(() => {})
    beat()
    const t = setInterval(() => {
      beat()
      setNow(Date.now())
    }, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [roomId, token, camOn, heartbeat])

  const online = new Set(
    (presence ?? []).filter((p) => now - p.lastSeen < PRESENCE_FRESH_MS && p.pid !== me).map((p) => p.pid),
  )
  const cameraFlags: Record<string, boolean> = {}
  for (const p of presence ?? []) cameraFlags[p.pid] = p.camera && now - p.lastSeen < PRESENCE_FRESH_MS

  const signal = useCallback(
    (to: string, kind: string, payload: unknown) => {
      if (!roomId || !token) return
      sendSignal({ roomId, token, to, kind, payload: JSON.stringify(payload) }).catch(() => {})
    },
    [roomId, token, sendSignal],
  )

  const dropPeer = useCallback((pid: string) => {
    const p = peers.current.get(pid)
    if (!p) return
    p.pc.close()
    peers.current.delete(pid)
    setRemote((r) => {
      const { [pid]: _, ...rest } = r
      return rest
    })
    setStatus((s) => {
      const { [pid]: _, ...rest } = s
      return rest
    })
  }, [])

  const attachLocal = (pc: RTCPeerConnection) => {
    const stream = localRef.current
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track?.kind
      const track = stream?.getTracks().find((x) => x.kind === kind) ?? null
      if (t.sender.track !== track) t.sender.replaceTrack(track).catch(() => {})
    }
  }

  const makePeer = useCallback(
    (pid: string, caller: boolean, cid: string): Peer => {
      dropPeer(pid)
      const pc = new RTCPeerConnection({ iceServers: iceServers() })
      const stream = new MediaStream()
      const peer: Peer = { pc, cid, caller, pendingIce: [], stream }
      peers.current.set(pid, peer)
      setStatus((s) => ({ ...s, [pid]: 'connecting' }))
      pc.onicecandidate = (e) => {
        if (e.candidate) signal(pid, 'ice', { cid, cand: e.candidate.toJSON() })
      }
      pc.ontrack = (e) => {
        if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track)
        setRemote((r) => ({ ...r, [pid]: stream }))
      }
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState
        if (peers.current.get(pid)?.pc !== pc) return
        if (st === 'connected') setStatus((s) => ({ ...s, [pid]: 'connected' }))
        if (st === 'failed') {
          setStatus((s) => ({ ...s, [pid]: 'failed' }))
          // The caller retries with a fresh connection.
          if (caller) setTimeout(() => peers.current.get(pid)?.pc === pc && startCall(pid), 2500)
        }
      }
      return peer
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dropPeer, signal],
  )

  const startCall = useCallback(
    async (pid: string) => {
      const cid = Math.random().toString(36).slice(2)
      const peer = makePeer(pid, true, cid)
      const { pc } = peer
      const stream = localRef.current
      for (const kind of ['audio', 'video'] as const) {
        const track = stream?.getTracks().find((t) => t.kind === kind)
        pc.addTransceiver(track ?? kind, { direction: 'sendrecv', streams: stream ? [stream] : [] })
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      signal(pid, 'offer', { cid, desc: pc.localDescription })
    },
    [makePeer, signal],
  )

  // Process incoming signals.
  useEffect(() => {
    if (!inbox || !roomId || !token || !me) return
    const done: Id<'signals'>[] = []
    ;(async () => {
      for (const s of inbox) {
        done.push(s.id as Id<'signals'>)
        if (processed.current.has(s.id)) continue
        processed.current.add(s.id)
        if (s.createdAt < mountedAt.current - 15_000) continue // stale from an earlier visit
        const payload = JSON.parse(s.payload)
        try {
          if (s.kind === 'hello') {
            // The other side (re)joined: as caller, start a fresh call.
            if (me < s.from) await startCall(s.from)
          } else if (s.kind === 'offer') {
            const peer = makePeer(s.from, false, payload.cid)
            const { pc } = peer
            await pc.setRemoteDescription(payload.desc)
            for (const t of pc.getTransceivers()) t.direction = 'sendrecv'
            attachLocal(pc)
            for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {})
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            signal(s.from, 'answer', { cid: payload.cid, desc: pc.localDescription })
          } else if (s.kind === 'answer') {
            const peer = peers.current.get(s.from)
            if (peer && peer.cid === payload.cid && peer.pc.signalingState === 'have-local-offer') {
              await peer.pc.setRemoteDescription(payload.desc)
              for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
            }
          } else if (s.kind === 'ice') {
            const peer = peers.current.get(s.from)
            if (!peer || peer.cid !== payload.cid) continue
            if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(payload.cand).catch(() => {})
            else peer.pendingIce.push(payload.cand)
          }
        } catch (e) {
          console.warn('signal error', s.kind, e)
        }
      }
      if (done.length) ack({ roomId, token, ids: done }).catch(() => {})
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox])

  // Keep the mesh in step with who is online.
  const onlineKey = [...online].sort().join(',')
  const greeted = useRef(new Set<string>())
  useEffect(() => {
    if (!me || !roomId) return
    for (const pid of online) {
      if (peers.current.has(pid)) continue
      if (me < pid) startCall(pid)
      else if (!greeted.current.has(pid)) {
        greeted.current.add(pid)
        signal(pid, 'hello', {})
      }
    }
    for (const pid of [...peers.current.keys()]) {
      if (!online.has(pid)) {
        dropPeer(pid)
        greeted.current.delete(pid)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey, me, roomId])

  // Close everything on unmount.
  useEffect(
    () => () => {
      for (const pid of [...peers.current.keys()]) peers.current.get(pid)?.pc.close()
      peers.current.clear()
      localRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  const enableMedia = useCallback(async () => {
    setMediaError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError('This browser cannot share a camera here. Use a recent Chrome, Safari or Firefox over HTTPS.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      localRef.current = stream
      setLocal(stream)
      setCamOn(true)
      setMicOn(true)
      for (const { pc } of peers.current.values()) attachLocal(pc)
    } catch (e: any) {
      setMediaError(
        e?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera and microphone for this site in your browser settings, then try again.'
          : 'No camera or microphone was found.',
      )
    }
  }, [])

  const toggleCam = useCallback(() => {
    const t = localRef.current?.getVideoTracks()[0]
    if (!t) return enableMedia()
    t.enabled = !t.enabled
    setCamOn(t.enabled)
  }, [enableMedia])

  const toggleMic = useCallback(() => {
    const t = localRef.current?.getAudioTracks()[0]
    if (!t) return enableMedia()
    t.enabled = !t.enabled
    setMicOn(t.enabled)
  }, [enableMedia])

  return { local, camOn, micOn, mediaError, enableMedia, toggleCam, toggleMic, remote, status, online, cameraFlags }
}

export type VideoMesh = ReturnType<typeof useVideoMesh>
