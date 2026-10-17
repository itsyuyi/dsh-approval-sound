/**
 * Plays the operating system's notification sound whenever a session has a
 * prompt that waits for a human decision:
 *
 * - `approval/request`       — permission / sandbox approvals
 * - `user-questions/request` — ask_user_question prompts (incl. plan review)
 *
 * The plugin only observes: it always delegates to `next()` and never claims
 * a request, so approval behavior is unchanged. It also never lets sound
 * playback interfere with the approval chain (all playback errors are
 * swallowed asynchronously).
 *
 * Configuration layers (later wins):
 *   1. defaults
 *   2. the loader row config in `cordis.patch.yml`
 *   3. `config.json` in this package directory — written by the Settings UI
 *      page (设置 → 插件 → 授权提示音) or edited by hand; the file is watched
 *      and changes apply live, no restart needed.
 *
 * Keys: `enabled`, `approvals`, `questions`, `sound` ('system' or an absolute
 * audio-file path), `cooldownMs`.
 *
 * @module @local/approval-sound
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'approval-sound'
export const inject = ['webServer']

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = `${BUNDLE_DIR}/config.json`
const CONFIG_ROUTE = '/plugins/approval-sound/config'
const PLAY_ROUTE = '/plugins/approval-sound/play'
const MAX_BODY_BYTES = 64 * 1024

const PLATFORM = process.platform

const DEFAULTS = Object.freeze({
  enabled: true,
  approvals: true,
  questions: true,
  sound: 'system',
  cooldownMs: 1500,
})

const BOOLEAN_KEYS = ['enabled', 'approvals', 'questions']

/* ------------------------------------------------------------------ */
/* Sound playback                                                      */
/* ------------------------------------------------------------------ */

const DARWIN_SYSTEM_SOUNDS = [
  '/System/Library/Sounds/Ping.aiff',
  '/System/Library/Sounds/Glass.aiff',
]

const LINUX_SYSTEM_SOUNDS = [
  '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga',
  '/usr/share/sounds/freedesktop/stereo/bell.oga',
]

/** Ordered argv candidates for one configured sound; first one that spawns wins. */
function candidatesFor(sound) {
  const custom = sound !== 'system' ? sound : undefined
  if (custom && !existsSync(custom)) return []
  if (PLATFORM === 'darwin') {
    if (custom) return [['afplay', custom]]
    const files = DARWIN_SYSTEM_SOUNDS.filter(existsSync)
    const list = files.map((file) => ['afplay', file])
    list.push(['osascript', '-e', 'beep'])
    return list
  }
  if (PLATFORM === 'win32') {
    if (custom) {
      const path = custom.replace(/'/g, "''")
      return [['powershell', '-NoProfile', '-NonInteractive', '-Command',
        `(New-Object Media.SoundPlayer '${path}').PlaySync()`]]
    }
    return [['powershell', '-NoProfile', '-NonInteractive', '-Command',
      '[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 700']]
  }
  if (PLATFORM === 'linux') {
    if (custom) {
      return [
        ['paplay', custom],
        ['pw-play', custom],
        ['aplay', '-q', custom],
        ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', custom],
      ]
    }
    const files = LINUX_SYSTEM_SOUNDS.filter(existsSync)
    return [
      ['canberra-gtk-play', '-i', 'dialog-warning'],
      ...files.map((file) => ['paplay', file]),
      ['aplay', '-q', '/usr/share/sounds/alsa/Front_Center.wav'],
    ]
  }
  return []
}

/** Spawn one argv; resolves once the process started, rejects on spawn failure. */
function attempt(argv) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: 'ignore',
        detached: PLATFORM !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    const settle = (fn) => (arg) => {
      if (!settled) {
        settled = true
        fn(arg)
      }
    }
    child.once('error', settle(reject))
    child.once('spawn', settle(() => {
      child.unref()
      resolve()
    }))
  })
}

/** Try the candidate commands in order; warn once when none can play. */
async function play(sound, logger, warnedRef) {
  const candidates = candidatesFor(sound)
  if (candidates.length === 0) {
    if (!warnedRef.value) {
      warnedRef.value = true
      logger?.warn(`[${name}] no usable audio source for sound=${JSON.stringify(sound)} on ${PLATFORM}`)
    }
    return false
  }
  for (const argv of candidates) {
    try {
      await attempt(argv)
      return true
    } catch {
      /* try the next candidate */
    }
  }
  if (!warnedRef.value) {
    warnedRef.value = true
    logger?.warn(`[${name}] every audio player failed on ${PLATFORM}`)
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Config file                                                         */
/* ------------------------------------------------------------------ */

function readFileConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mergeConfig(rowConfig, fileConfig) {
  const merged = { ...DEFAULTS, ...rowConfig, ...fileConfig }
  for (const key of BOOLEAN_KEYS) {
    if (typeof merged[key] !== 'boolean') merged[key] = DEFAULTS[key]
  }
  if (typeof merged.sound !== 'string' || merged.sound === '') merged.sound = DEFAULTS.sound
  if (!Number.isFinite(merged.cooldownMs) || merged.cooldownMs < 0) merged.cooldownMs = DEFAULTS.cooldownMs
  return merged
}

/** Validate a client-supplied partial config; returns an error string or null. */
function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return 'config must be an object'
  for (const key of BOOLEAN_KEYS) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') return `${key} must be a boolean`
  }
  if (patch.sound !== undefined && (typeof patch.sound !== 'string' || patch.sound.trim() === '')) {
    return 'sound must be a non-empty string'
  }
  if (patch.cooldownMs !== undefined && (!Number.isFinite(patch.cooldownMs) || patch.cooldownMs < 0)) {
    return 'cooldownMs must be a non-negative number'
  }
  return null
}

function pickConfigKeys(input) {
  const next = {}
  for (const key of [...BOOLEAN_KEYS, 'sound', 'cooldownMs']) {
    if (input[key] !== undefined) next[key] = input[key]
  }
  return next
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing (same shape the shipped plugin routes use)            */
/* ------------------------------------------------------------------ */

function sameOrigin(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    return false
  }
  return true
}

async function readBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function jsonError(res, status, error, message) {
  json(res, status, message === undefined ? { ok: false, error } : { ok: false, error, message })
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {import('cordis').Context} ctx
 * @param {Record<string, unknown>} rowConfig
 */
export function apply(ctx, rowConfig = {}) {
  const state = { config: mergeConfig(rowConfig, readFileConfig()), lastPlayedAt: 0 }
  const warnedRef = { value: false }

  const reloadFromFile = () => {
    try {
      state.config = mergeConfig(rowConfig, readFileConfig())
    } catch {
      /* keep the previous config */
    }
  }

  /* Live-reload config.json when the Settings page or a manual edit writes it. */
  ctx.effect(() => {
    let timer = null
    const watcher = watch(BUNDLE_DIR, (_event, filename) => {
      if (filename !== 'config.json') return
      clearTimeout(timer)
      timer = setTimeout(reloadFromFile, 150)
    })
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  }, 'approval-sound: config.json watcher')

  /* GET/PUT: read the effective config, or persist a partial update to
     config.json and apply it live. */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_ROUTE,
    handler: async (req, res) => {
      if (!sameOrigin(req)) return jsonError(res, 403, 'origin-rejected')
      if (req.method === 'GET') return json(res, 200, { ok: true, config: state.config })
      if (req.method !== 'PUT') return jsonError(res, 405, 'method-not-allowed')
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        return jsonError(res, 400, 'invalid-json')
      }
      const error = validatePatch(body?.config)
      if (error !== null) return jsonError(res, 400, 'invalid-config', error)
      const next = { ...readFileConfig(), ...pickConfigKeys(body?.config ?? {}) }
      try {
        writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`)
      } catch (writeError) {
        return jsonError(res, 500, 'write-failed', String(writeError))
      }
      state.config = mergeConfig(rowConfig, next)
      json(res, 200, { ok: true, config: state.config })
    },
  }), 'approval-sound: config route')

  /* POST: play the sound once now (the Settings page's test button). */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PLAY_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'POST') return jsonError(res, 405, 'method-not-allowed')
      if (!sameOrigin(req)) return jsonError(res, 403, 'origin-rejected')
      const played = await play(state.config.sound, ctx.logger, warnedRef)
      json(res, played ? 200 : 503, { ok: played })
    },
  }), 'approval-sound: play route')

  const notify = (kind) => {
    if (!state.config.enabled) return
    if (kind === 'approval' && !state.config.approvals) return
    if (kind === 'question' && !state.config.questions) return
    const now = Date.now()
    if (now - state.lastPlayedAt < state.config.cooldownMs) return
    state.lastPlayedAt = now
    play(state.config.sound, ctx.logger, warnedRef).catch(() => {})
  }

  /** Play the sound, then delegate the decision — never claim it. */
  const observe = (kind, next) => {
    try {
      notify(kind)
    } catch {
      /* observation must never break the approval chain */
    }
    return next()
  }

  ctx.on('approval/request', (_req, next) => observe('approval', next), true)
  ctx.on('user-questions/request', (_req, next) => observe('question', next), true)
}
