/**
 * DSH 单会话记忆插件（dsh-session-memory）
 *
 * 目标：让**每个会话各自记自己的事**，互不可见。
 *
 * 设计边界
 * - 只读写自己的数据目录，绝不碰会话工作区文件。
 * - 记忆按 sessionId 分文件存放，A 会话的记忆永远不会出现在 B 会话的上下文里。
 * - 注入走官方通道 ctx.systemPrompt.context()：每轮组装时按 context.agent.id 取本会话记忆，
 *   成为带来源的 runtime-context，不污染对话正文。
 * - 关闭开关后立即停止注入（数据不删）。
 *
 * 数据目录：~/.dsh/session-memory/
 *   sessions/<sessionId>.json   每个会话一份
 *   exports/                    导出留档（面板导出走浏览器下载，这里只兜底）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-session-memory'
export const inject = ['tools']

const PLUGIN_VERSION = '1.0.0'

const DEFAULT_CONFIG = {
  stateDir: join(homedir(), '.dsh', 'session-memory'),
  defaultInjectLimit: 20,
  maxEntries: 500,
  maxCharacters: 100,
  maxDiary: 2000,
  exportFormat: 'md',
  injectOrder: 850,
  // 注入里带「什么时候该记」的引导。光给工具不写引导，模型基本不会主动记。
  autoHint: true,
  // 群聊插件（dsh-session-chat-final）的探测地址；探不到就不显示「群聊回复意向」
  chatApiPath: '/dsh-session-chat-api',
  // 新会话默认是否开启「独占记忆」（屏蔽 dsh-mnemon 等其他记忆板块）。默认关。
  defaultExclusive: false,
  // 独占时要压掉的东西：插件消息的 source.kind，和提示段的 name
  blockMessageSources: ['dsh-mnemon', 'plugin:dsh-mnemon'],
  blockSectionNames: ['mnemon:routing'],
}

const ENTRY_KINDS = ['fact', 'preference', 'decision', 'person']
const KIND_LABEL = {
  fact: '事实',
  preference: '偏好',
  decision: '决定',
  person: '人物',
}

// ---------------------------------------------------------------------------
// 情绪模块（原 dsh-session-mood，已并入本插件）
// ---------------------------------------------------------------------------

const EMOTIONS = [
  { id: 'happy', label: '开心', emoji: '😊' },
  { id: 'calm', label: '平静', emoji: '😐' },
  { id: 'down', label: '低落', emoji: '😞' },
  { id: 'angry', label: '生气', emoji: '😠' },
  { id: 'shy', label: '害羞', emoji: '😳' },
  { id: 'excited', label: '兴奋', emoji: '🤩' },
  { id: 'tired', label: '疲惫', emoji: '😪' },
  { id: 'sad', label: '委屈', emoji: '🥺' },
]

const EMOTION_IDS = EMOTIONS.map((e) => e.id)
const EMOTION_BY_ID = new Map(EMOTIONS.map((e) => [e.id, e]))

function defaultEmotions() {
  const out = {}
  for (const id of EMOTION_IDS) out[id] = 0
  out.calm = 60
  return out
}

function clampEmotion(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function emptyMood() {
  return {
    enabled: true,
    personality: { text: '', tags: [] },
    emotions: defaultEmotions(),
    needsJudge: true,
    history: [],
  }
}

function normalizeMood(raw) {
  const base = emptyMood()
  if (!raw || typeof raw !== 'object') return base

  const emotions = { ...base.emotions }
  for (const id of EMOTION_IDS) {
    if (raw.emotions && Number.isFinite(raw.emotions[id])) emotions[id] = clampEmotion(raw.emotions[id])
  }

  return {
    enabled: raw.enabled !== false,
    personality: {
      text: typeof raw.personality?.text === 'string' ? raw.personality.text : '',
      tags: Array.isArray(raw.personality?.tags)
        ? raw.personality.tags
            .filter((t) => typeof t === 'string' && t.trim())
            .map((t) => t.trim().slice(0, 20))
            .slice(0, 20)
        : [],
    },
    emotions,
    // 老数据没这个字段 = 已经判断过了
    needsJudge: raw.needsJudge === true,
    history: Array.isArray(raw.history)
      ? raw.history
          .filter((h) => h && typeof h === 'object')
          .slice(-30)
          .map((h) => ({
            at: Number(h.at) || Date.now(),
            by: h.by === 'ai' ? 'ai' : 'user',
            reason: typeof h.reason === 'string' ? h.reason : '',
            changes: h.changes && typeof h.changes === 'object' ? h.changes : {},
          }))
      : [],
  }
}

const CARD_FIELDS = [
  ['name', '姓名'],
  ['alias', '别称'],
  ['role', '身份/关系'],
  ['appearance', '外貌'],
  ['personality', '性格'],
  ['background', '背景'],
  ['speech', '口吻/说话方式'],
  ['notes', '备注'],
]

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------

function safeName(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'unknown'
}

/** 旧版独立情绪插件（dsh-session-mood）的数据目录，用于一次性自动迁移 */
const LEGACY_MOOD_DIR = join(homedir(), '.dsh', 'session-mood', 'sessions')

function loadLegacyMood(sessionId) {
  try {
    return JSON.parse(readFileSync(join(LEGACY_MOOD_DIR, `${safeName(sessionId)}.json`), 'utf8'))
  } catch {
    return null
  }
}

function emptyMemory(sessionId) {
  return {
    version: 1,
    sessionId,
    enabled: true,
    injectLimit: DEFAULT_CONFIG.defaultInjectLimit,
    chatIntent: null,
    exclusive: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: [],
    characters: [],
    diary: [],
    mood: emptyMood(),
  }
}

function createStore(config) {
  const root = config.stateDir
  const dir = join(root, 'sessions')
  const cache = new Map()

  function ensureDirs() {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* 目录已在时忽略 */
    }
  }

  function fileOf(sessionId) {
    return join(dir, `${safeName(sessionId)}.json`)
  }

  /** 读一份会话记忆；带 mtime 缓存，避免每轮组装都真读盘。 */
  function load(sessionId) {
    if (!sessionId) return null
    const file = fileOf(sessionId)
    let mtime = 0
    try {
      mtime = statSync(file).mtimeMs
    } catch {
      mtime = 0
    }
    const hit = cache.get(file)
    if (hit && hit.mtime === mtime) return hit.data

    let data
    if (!mtime) {
      data = emptyMemory(sessionId)
      // 记忆文件还没建，但可能有独立情绪插件留下的数据
      const legacy = loadLegacyMood(sessionId)
      if (legacy) data.mood = normalizeMood(legacy)
    } else {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        data = normalize(raw, sessionId)
        // 从旧版 dsh-session-mood 的独立文件自动迁移一次
        if (!raw.mood) {
          const legacy = loadLegacyMood(sessionId)
          if (legacy) data.mood = normalizeMood(legacy)
        }
      } catch {
        data = emptyMemory(sessionId)
      }
    }
    cache.set(file, { mtime, data })
    return data
  }

  function save(sessionId, data) {
    ensureDirs()
    const file = fileOf(sessionId)
    data.sessionId = sessionId
    data.updatedAt = Date.now()
    // 控制总量，避免单文件无限膨胀
    if (data.entries.length > config.maxEntries) data.entries = data.entries.slice(-config.maxEntries)
    if (data.characters.length > config.maxCharacters) data.characters = data.characters.slice(-config.maxCharacters)
    const text = JSON.stringify(data, null, 2)
    writeFileSync(file, text, 'utf8')
    let mtime = 0
    try {
      mtime = statSync(file).mtimeMs
    } catch {
      mtime = Date.now()
    }
    cache.set(file, { mtime, data })
    return data
  }

  /** 只读快照，给面板和注入用（不落盘）。 */
  function peek(sessionId) {
    return load(sessionId) || emptyMemory(sessionId)
  }

  function listSessions() {
    ensureDirs()
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(dir, f), 'utf8'))
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  return { load, save, peek, listSessions, ensureDirs, fileOf, root }
}

function text18(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.trim() ? value : fallback
}

function normalize(raw, sessionId) {
  const base = emptyMemory(sessionId)
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base,
    ...raw,
    sessionId,
    enabled: raw.enabled !== false,
    mood: normalizeMood(raw.mood),
    injectLimit: Number.isFinite(raw.injectLimit) ? raw.injectLimit : base.injectLimit,
    chatIntent: Number.isFinite(raw.chatIntent)
      ? Math.max(0, Math.min(100, Math.round(raw.chatIntent)))
      : null,
    exclusive: typeof raw.exclusive === 'boolean' ? raw.exclusive : null,
    entries: Array.isArray(raw.entries)
      ? raw.entries.filter((e) => e && typeof e.text === 'string').map((e) => ({
          id: e.id || randomUUID(),
          text: e.text,
          kind: ENTRY_KINDS.includes(e.kind) ? e.kind : 'fact',
          tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [],
          pinned: e.pinned === true,
          // 艾宾浩斯：被复习的次数越多，衰减越慢
          reinforceCount: Number.isFinite(e.reinforceCount) ? Math.max(0, e.reinforceCount) : 0,
          lastUsedAt: Number(e.lastUsedAt) || Number(e.createdAt) || Date.now(),
          createdAt: Number(e.createdAt) || Date.now(),
          updatedAt: Number(e.updatedAt) || Number(e.createdAt) || Date.now(),
        }))
      : [],
    // 日记：每次写记忆都留一份原文，永不过期、永不注入
    diary: Array.isArray(raw.diary)
      ? raw.diary
          .filter((d) => d && typeof d.text === 'string')
          .slice(-DEFAULT_CONFIG.maxDiary)
          .map((d) => ({
            id: d.id || randomUUID(),
            text: d.text,
            kind: ENTRY_KINDS.includes(d.kind) ? d.kind : 'fact',
            tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [],
            at: Number(d.at) || Date.now(),
          }))
      : [],
    characters: Array.isArray(raw.characters)
      ? raw.characters.filter((c) => c && typeof c.name === 'string').map((c) => ({
          id: c.id || randomUUID(),
          name: c.name,
          alias: text18(c.alias),
          role: text18(c.role),
          appearance: text18(c.appearance),
          personality: text18(c.personality),
          background: text18(c.background),
          speech: text18(c.speech),
          notes: text18(c.notes),
          pinned: c.pinned === true,
          createdAt: Number(c.createdAt) || Date.now(),
          updatedAt: Number(c.updatedAt) || Number(c.createdAt) || Date.now(),
        }))
      : [],
  }
}

/**
 * 判断一条消息是不是别的记忆插件塞进来的（目前认 dsh-mnemon 的两种写法）。
 * dsh-mnemon 在 agent/pre-step 里追加 `source: { kind: 'dsh-mnemon', form }` 的 user 消息，
 * 那就是它那份 MNEMON RUNTIME MEMORY SNAPSHOT。
 */
function isBlockedMessageSource(source, blocked) {
  if (!source || typeof source !== 'object') return false
  const { kind, plugin } = source
  if (typeof kind === 'string' && blocked.includes(kind)) return true
  return kind === 'plugin' && typeof plugin === 'string' && blocked.includes(plugin)
}

// ---------------------------------------------------------------------------
// 渲染：注入到模型上下文的那一块
// ---------------------------------------------------------------------------

function clip(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

const DAY_MS = 86400000

/**
 * 艾宾浩斯保留率：越久没被碰到越低；复习一次稳定度翻倍，就更抗遗忘。
 * 置顶记忆不衰减（r = 1）。
 */
function retention(entry, now = Date.now()) {
  if (entry.pinned) return 1
  const last = Number(entry.lastUsedAt) || Number(entry.createdAt) || now
  const days = Math.max(0, (now - last) / DAY_MS)
  const stability = 1 + (Number(entry.reinforceCount) || 0) * 2
  return Math.exp(-days / stability)
}

/**
 * 按保留率分三级：
 * - full  (r ≥ 0.6) 完整注入
 * - brief (0.25 ≤ r < 0.6) 压缩成一行
 * - faded (r < 0.25 或超出配额) 不注入，但仍在库里、日记里也有原文
 */
function gradeEntries(mem, now = Date.now()) {
  const scored = (mem.entries || []).map((entry) => ({ entry, r: retention(entry, now) }))
  const pinned = scored.filter((x) => x.entry.pinned)
  const rest = scored.filter((x) => !x.entry.pinned).sort((a, b) => b.r - a.r)

  const room = Math.max(0, mem.injectLimit - pinned.length)
  const picked = rest.slice(0, room)
  const overflow = rest.slice(room)

  const full = []
  const brief = []
  const faded = []

  for (const { entry, r } of [...pinned, ...picked]) {
    if (r >= 0.6) full.push(entry)
    else if (r >= 0.25) brief.push(entry)
    else faded.push(entry)
  }
  for (const { entry } of overflow) faded.push(entry)

  return { full, brief, faded }
}


/** 情绪 + 性格那一段（原 dsh-session-mood 的注入内容） */
function renderMoodLines(mood, cfg = {}) {
  if (!mood || mood.enabled === false) return []
  const lines = []

  const custom = String(mood.personality?.text || '').trim()
  const tags = Array.isArray(mood.personality?.tags) ? mood.personality.tags : []
  if (custom || tags.length) {
    lines.push('【当前性格】')
    if (custom) lines.push(custom)
    if (tags.length) lines.push(`自己贴上的标签：${tags.map((t) => `#${t}`).join(' ')}`)
  }
  lines.push('性格不是预设好的，是你自己在对话里长出来的：')
  lines.push('发现自己确实有某种倾向（嘴硬心软、护短、爱记仇、怕麻烦…），用 session_mood 的 personality + addTag 贴上去，之后按这些标签行事。')

  lines.push('')
  if (mood.needsJudge) {
    lines.push('【当前情绪 · 还没定】')
    lines.push('这个会话你还没有情绪状态。先读完这轮对话，然后给自己定一个初始心情：')
    lines.push('· 想想刚才看到的内容让你有什么感觉，挑 1-3 个情绪')
    lines.push('· 用 session_mood 的 set（或 emotions 对象一次给多个）写进去，0-100')
    lines.push('· 不确定就按角色性格猜一个合理的，不要留空')
  } else {
    const tops = EMOTIONS.map((e) => ({ ...e, value: mood.emotions?.[e.id] ?? 0 }))
      .filter((e) => e.value >= 25)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)

    lines.push('【当前情绪】')
    if (tops.length === 0) {
      lines.push('此刻情绪很平，没有特别强烈的感受。')
    } else {
      lines.push(tops.map((e) => `${e.label} ${e.value}/100`).join('　'))
      lines.push('把这股情绪体现在**措辞、节奏和取舍**里，但不要自报「我现在很开心」这种话。')
    }
    lines.push('')
    lines.push('【情绪检查 · 每轮过一遍】')
    lines.push('回复前判断：这一轮对话让你的情绪有波动吗？')
    lines.push('· 被夸 / 被逗 / 被冷落 / 被催 / 话题变沉重… → 用 session_mood 的 adjust 调 1-2 个情绪（±10~30 就够）')
    lines.push('· 平平淡淡 → 不动，别硬凑。')
    lines.push('情绪是会变的，长时间停在同一个值才是异常的。')
  }

  return lines
}

function renderMemoryBlock(mem, cfg = {}) {
  if (!mem || mem.enabled === false) return ''
  const { full, brief, faded } = gradeEntries(mem)
  const chars = mem.characters.slice(-Math.max(0, Math.min(mem.characters.length, mem.injectLimit)))
  const autoHint = cfg.autoHint !== false
  const hasContent = full.length > 0 || brief.length > 0 || chars.length > 0

  const lines = []

  // 先性格情绪，再记忆
  const moodLines = renderMoodLines(mem.mood, cfg)
  if (moodLines.length) {
    lines.push(...moodLines)
    lines.push('')
  }

  if (hasContent) {
    lines.push('【本会话记忆】')
    lines.push('以下内容属于**当前这个会话**，是它自己攒下来的记录；除与当前用户消息冲突外，默认仍然有效。')

    if (full.length) {
      lines.push('')
      for (const e of full) {
        const label = KIND_LABEL[e.kind] || '事实'
        lines.push(`- （${label}）${clip(e.text, 300)}`)
      }
    }

    // 保留率掉到 0.25~0.6 的记忆：压成一行，只留骨架
    if (brief.length) {
      lines.push('')
      lines.push('【快淡忘的记忆（压成一行，要细节用 session_memory list 查）】')
      for (const e of brief) {
        const label = KIND_LABEL[e.kind] || '事实'
        lines.push(`- （${label}）${clip(e.text, 60)}`)
      }
    }

    if (chars.length) {
      lines.push('')
      lines.push('【本会话人物卡】')
      for (const c of chars) {
        const head = [c.name, c.alias ? `（${c.alias}）` : '', c.role ? `｜${c.role}` : ''].join('')
        lines.push(`- ${head}`)
        for (const [key, label] of CARD_FIELDS) {
          if (key === 'name' || key === 'alias' || key === 'role') continue
          if (c[key]) lines.push(`  · ${label}：${clip(c[key], 240)}`)
        }
      }
    }

    if (faded.length) {
      lines.push('')
      lines.push(`（另有 ${faded.length} 条更早的记忆已经淡出上下文，原文都在日记里）`)
    }
  }

  // 引导：没有这条，模型基本不会主动记（只给工具不够）
  // 写成「检查清单 + 明确动作」而不是软建议——软建议会被它一路掠过。
  if (autoHint) {
    if (!hasContent) {
      lines.push('【本会话记忆】')
      lines.push('（目前还没有任何记录。）')
    }
    lines.push('')
    lines.push('【记忆检查 · 每轮过一遍】')
    lines.push('回复前用三秒扫一遍，这轮有没有出现下面任一条：')
    lines.push('· 用户新说的偏好 / 习惯 / 禁忌 / 希望被怎么称呼')
    lines.push('· 约定、决定、分工、以后要遵守的规则')
    lines.push('· 不会再变的事实：人名、关系、项目设定、技术结论')
    lines.push('· 角色设定细节（外貌、性格、口吻、背景）')
    lines.push('有 → 立刻调 session_memory 的 add 记下来，一条只写一件事。')
    lines.push('没有 → 什么都别记，不要凑数写废话。')
  }

  // 群聊回复意向：只在手动设过（非 null）时注入
  if (Number.isFinite(mem.chatIntent)) {
    lines.push('')
    lines.push('【群聊回复意向】')
    lines.push(
      `当前设为 ${mem.chatIntent}%。收到群聊消息时按这个意向决定接不接话：` +
        `数值低就多听少说、能不接就不接；数值高就正常回应。` +
        `被 @ 时不受此限制，@ 一律回应。`,
    )
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

function toMarkdown(mem) {
  const lines = []
  lines.push(`# 会话记忆 · ${mem.sessionId}`)
  lines.push('')
  lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push(`- 开关：${mem.enabled ? '开启' : '关闭'}`)
  lines.push(`- 生效条数上限：${mem.injectLimit}`)
  lines.push(`- 记忆条数：${mem.entries.length}　人物卡：${mem.characters.length}`)
  lines.push('')

  lines.push('## 记忆条目')
  if (!mem.entries.length) lines.push('_（空）_')
  for (const e of mem.entries) {
    const label = KIND_LABEL[e.kind] || '事实'
    const pin = e.pinned ? ' 📌' : ''
    lines.push(`- **（${label}）**${pin} ${e.text}`)
    if (e.tags?.length) lines.push(`  - 标签：${e.tags.join('、')}`)
    lines.push(`  - 记录于 ${new Date(e.createdAt).toLocaleString('zh-CN')}`)
  }
  lines.push('')

  lines.push('## 人物卡')
  if (!mem.characters.length) lines.push('_（空）_')
  for (const c of mem.characters) {
    lines.push(`### ${c.name}${c.alias ? `（${c.alias}）` : ''}`)
    for (const [key, label] of CARD_FIELDS) {
      if (key === 'name') continue
      if (c[key]) lines.push(`- **${label}**：${c[key]}`)
    }
    lines.push('')
  }

  // 日记：原文一条不落，按时间正序
  const diary = mem.diary || []
  lines.push('## 日记（原文，永不删）')
  lines.push('')
  if (!diary.length) lines.push('_（空）_')
  for (const d of diary) {
    const when = new Date(d.at).toLocaleString('zh-CN')
    lines.push(`- ${when}　（${KIND_LABEL[d.kind] || '事实'}）${d.text}`)
  }

  return lines.join('\n')
}

function toJson(mem) {
  return JSON.stringify(
    {
      plugin: 'dsh-session-memory',
      version: PLUGIN_VERSION,
      exportedAt: new Date().toISOString(),
      memory: mem,
    },
    null,
    2,
  )
}

// ---------------------------------------------------------------------------
// 人物卡：导入 / 单独导出 / 格式自动转换
// ---------------------------------------------------------------------------

/**
 * 常见人物卡格式的字段别名 → 本插件的字段。
 * 比较时统一转小写，所以中英文、大小写、连字符都能命中。
 */
const CARD_KEY_ALIASES = {
  name: ['name', '姓名', '名字', '名称', 'char_name', 'charname', 'character_name', 'full_name'],
  alias: ['alias', 'aliases', 'nickname', 'nick_name', '别称', '昵称', '又称', '小名', 'aka'],
  role: ['role', '身份', '关系', '身份关系', '身份/关系', '职位', '职业', 'occupation', 'position', 'title'],
  appearance: ['appearance', '外貌', '长相', '外形', '外观', '樣貌', 'look', 'looks', 'visual'],
  personality: ['personality', '性格', '性情', '个性', 'trait', 'traits', 'temperament'],
  background: ['background', '背景', '经历', '生平', '过往', 'backstory', 'history', 'bio', 'biography'],
  speech: [
    'speech',
    '口吻',
    '说话方式',
    '口癖',
    '语气',
    '说话风格',
    'voice',
    'speech_pattern',
    'mes_example',
    'example_dialogue',
    'dialogue',
  ],
  notes: [
    'notes',
    'note',
    '备注',
    '说明',
    '其他',
    '补充',
    'memo',
    'remark',
    'creator_notes',
    'creator_comment',
    'scenario',
    'first_mes',
    'greeting',
    'system_prompt',
    'post_history_instructions',
    '标签',
    'tags',
  ],
  // 虚拟字段：一大段人设描述。按「外貌 → 背景 → 备注」依次找空位落，
  // 不能直接塞 notes，否则酒馆卡的 description 会被 creator_notes 挤掉。
  _desc: ['description', 'persona', 'summary', '简介', '描述', '设定', '人设'],
}

const CARD_TEXT_MAX = 4000
const IMPORT_CARD_LIMIT = 200

function lowerIndex(obj) {
  const m = new Map()
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') {
      m.set(String(k).toLowerCase().trim(), v)
    } else if (typeof v === 'number') {
      m.set(String(k).toLowerCase().trim(), String(v))
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      m.set(String(k).toLowerCase().trim(), v.join('、'))
    }
  }
  return m
}

function pickField(idx, field) {
  for (const alias of CARD_KEY_ALIASES[field] || []) {
    const v = idx.get(alias)
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function clipCard(value) {
  const s = String(value ?? '').trim()
  return s.length > CARD_TEXT_MAX ? `${s.slice(0, CARD_TEXT_MAX)}…` : s
}

/** 把任意一个对象转成一张卡（不校验 name，由调用方过滤）。 */
function buildCardFromObject(obj) {
  const idx = lowerIndex(obj)
  const card = {}
  for (const [field] of CARD_FIELDS) {
    const v = pickField(idx, field)
    if (v) card[field] = clipCard(v)
  }
  // 一大段人设描述：按 外貌 → 背景 → 备注 的顺序找空位，别丢
  const desc = pickField(idx, '_desc')
  if (desc) {
    const clipped = clipCard(desc)
    if (!card.appearance) card.appearance = clipped
    else if (!card.background) card.background = clipped
    else card.notes = card.notes ? `${clipped}\n\n${card.notes}` : clipped
  }
  return card
}

/** 从已解析的 JSON 里挖出所有卡，兼容多种层级。 */
function cardsFromJson(parsed) {
  const out = []
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    // SillyTavern / 酒馆卡 v2、v3：{ spec, data: {...} }
    if (node.data && typeof node.data === 'object' && !Array.isArray(node.data)) {
      const looksLikeCard =
        typeof node.spec === 'string' ||
        typeof node.spec_version === 'string' ||
        typeof node.data.name === 'string' ||
        typeof node.data.char_name === 'string'
      if (looksLikeCard) {
        const card = buildCardFromObject(node.data)
        if (card.name) out.push(card)
        return
      }
    }
    // 容器字段
    for (const key of ['characters', 'cards', 'character', 'card', 'list', 'items', 'data']) {
      if (Array.isArray(node[key])) {
        visit(node[key], depth + 1)
        return
      }
    }
    // 自身就是一张卡
    const card = buildCardFromObject(node)
    if (card.name) out.push(card)
  }
  visit(parsed, 0)
  return out
}

/** 纯文本兜底：按「姓名：xxx」「外貌：xxx」这类键值行解析，遇到「姓名」开新卡。 */
function cardsFromText(text) {
  const fieldOf = (label) => {
    const l = String(label).toLowerCase().trim()
    for (const [field, aliases] of Object.entries(CARD_KEY_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === l)) return field
    }
    return null
  }
  const cards = []
  let cur = null
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*[-*#>+\s]*([^：:\n]{1,24})[：:]\s*(.+?)\s*$/)
    if (!m) continue
    const field = fieldOf(m[1])
    if (!field) continue
    if (field === 'name') {
      cur = { name: clipCard(m[2]) }
      cards.push(cur)
      continue
    }
    if (!cur) {
      cur = {}
      cards.push(cur)
    }
    cur[field] = clipCard(m[2])
  }
  return cards.filter((c) => c && c.name)
}

/** 主入口：任意文本 → 卡数组。 */
function parseCardsFromText(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { cards: [], source: 'empty', error: '内容是空的' }
  try {
    const parsed = JSON.parse(text)
    return { cards: cardsFromJson(parsed), source: 'json' }
  } catch {
    /* 不是 JSON，落到文本解析 */
  }
  const fromText = cardsFromText(text)
  return { cards: fromText, source: 'text' }
}

function cardsToMarkdown(cards, title = '人物卡') {
  const lines = [`# ${title}`, '', `- 导出时间：${new Date().toLocaleString('zh-CN')}`, `- 数量：${cards.length}`, '']
  if (!cards.length) lines.push('_（空）_')
  for (const c of cards) {
    lines.push(`## ${c.name}${c.alias ? `（${c.alias}）` : ''}`)
    for (const [key, label] of CARD_FIELDS) {
      if (key === 'name') continue
      if (c[key]) lines.push(`- **${label}**：${c[key]}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function cardsToJson(cards) {
  return JSON.stringify(
    {
      plugin: 'dsh-session-memory',
      version: PLUGIN_VERSION,
      kind: 'character-cards',
      exportedAt: new Date().toISOString(),
      count: cards.length,
      characters: cards,
    },
    null,
    2,
  )
}


// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const store = createStore(cfg)

  function withMemo(sessionId) {
    if (!sessionId) throw new Error('拿不到当前会话 id')
    return store.load(sessionId)
  }

  /** 拿到 mem.mood 并保证结构完整（老数据可能没有） */
  function memorMood(mem) {
    if (!mem.mood || typeof mem.mood !== 'object') mem.mood = emptyMood()
    const m = mem.mood
    if (!m.personality || typeof m.personality !== 'object') m.personality = { text: '', tags: [] }
    if (!Array.isArray(m.personality.tags)) m.personality.tags = []
    if (!m.emotions || typeof m.emotions !== 'object') m.emotions = defaultEmotions()
    if (!Array.isArray(m.history)) m.history = []
    return m
  }

  // ---- 全局设置（新会话默认值）----
  const settingsFile = join(store.root, 'settings.json')
  let settingsCache = null

  function loadSettings() {
    if (settingsCache) return settingsCache
    let raw = {}
    try {
      raw = JSON.parse(readFileSync(settingsFile, 'utf8'))
    } catch {
      raw = {}
    }
    settingsCache = {
      defaultExclusive: raw.defaultExclusive === true ? true : cfg.defaultExclusive === true,
      // 辅助判断记忆的模型（用户指定的 provider/model），默认关
      judge: {
        enabled: raw.judge?.enabled === true,
        provider: typeof raw.judge?.provider === 'string' ? raw.judge.provider : '',
        model: typeof raw.judge?.model === 'string' ? raw.judge.model : '',
        maxTokens: Number(raw.judge?.maxTokens) || 400,
        // 每隔几轮才叫一次判断模型（1 = 每轮，费 token）
        everyTurns: Number(raw.judge?.everyTurns) >= 1 ? Math.min(20, Math.round(Number(raw.judge.everyTurns))) : 3,
      },
    }
    return settingsCache
  }

  function saveSettings(patch) {
    const next = { ...loadSettings(), ...patch }
    store.ensureDirs()
    writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    settingsCache = next
    return next
  }

  // ---- 全局角色卡库（所有导入/新建的卡都统一存这里）----
  const libraryFile = join(store.root, 'cards.json')
  let libraryCache = null

  function loadLibrary() {
    if (libraryCache) return libraryCache
    let raw = { version: 1, cards: [] }
    try {
      const parsed = JSON.parse(readFileSync(libraryFile, 'utf8'))
      if (parsed && Array.isArray(parsed.cards)) raw = parsed
    } catch {
      /* 还没有库文件 */
    }
    libraryCache = { version: 1, cards: raw.cards.map(normalizeLibraryCard).filter(Boolean) }
    return libraryCache
  }

  function saveLibrary(cards) {
    const next = { version: 1, cards }
    store.ensureDirs()
    writeFileSync(libraryFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    libraryCache = next
    return next
  }

  function normalizeLibraryCard(raw) {
    if (!raw || typeof raw !== 'object') return null
    const base = buildCardFromObject(raw)
    if (!base.name) return null
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
      name: base.name,
      alias: base.alias || '',
      role: base.role || '',
      appearance: base.appearance || '',
      personality: base.personality || '',
      background: base.background || '',
      speech: base.speech || '',
      notes: base.notes || '',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    }
  }

  /** 把一张卡放进库：同名更新，异名新增。返回 {card, updated}。 */
  function upsertLibraryCard(input) {
    const lib = loadLibrary()
    const incoming = normalizeLibraryCard(input)
    if (!incoming) return null
    const sameName = lib.cards.find((c) => c.name.trim().toLowerCase() === incoming.name.trim().toLowerCase())
    if (sameName) {
      const merged = { ...sameName, ...incoming, id: sameName.id, createdAt: sameName.createdAt, updatedAt: Date.now() }
      saveLibrary(lib.cards.map((c) => (c.id === sameName.id ? merged : c)))
      return { card: merged, updated: true }
    }
    const created = { ...incoming, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now() }
    saveLibrary([...lib.cards, created])
    return { card: created, updated: false }
  }

  /** 本会话是否独占：会话里显式设过就听会话的，否则跟全局默认。 */
  function exclusiveFor(sessionId) {
    try {
      const mem = store.load(sessionId)
      if (mem && typeof mem.exclusive === 'boolean') return mem.exclusive
    } catch {
      /* 读不到就当没设过 */
    }
    return loadSettings().defaultExclusive === true
  }

  // ---- 独占记忆：把别的记忆板块压掉 ----
  // dsh-mnemon 并不走 ctx.systemPrompt.context()：它在 agent/pre-step 里额外追加一条
  // source.kind = 'dsh-mnemon' 的插件消息（就是那份 MNEMON RUNTIME MEMORY SNAPSHOT），
  // 另外还挂了一段名为 'mnemon:routing' 的提示段。
  // 官方的 suppressRuntimeContext() 只管「可选动态上下文」，压不掉这两种，
  // 所以只能在 agent 自己的链上动手：拿它算完的结果，再把别人的那份剔掉。
  // 每条会话记录「上一轮处理过的 turn」，避免同轮多次强化
  const lastAutoTurn = new Map()
  // 判断模型的轮次计数（按会话）
  const judgeTick = new Map()

  /**
   * 自动关联强化：这一轮用户说的话里如果出现了某条记忆的关键词，
   * 就当它被「提到」了——复习一次（衰减慢一倍），同标签的邻居也跟着小幅回暖。
   * 这就是「反复被提到的不容易忘」。
   */
  function autoReinforce(sessionId, messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0
    const mem = store.load(sessionId)
    if (!mem || mem.enabled === false) return 0
    const entries = mem.entries || []
    if (!entries.length) return 0

    // 只看这一轮里用户说的话
    const texts = []
    for (const m of messages) {
      if (!m || m.role !== 'user') continue
      if (m.source && (m.source.kind === 'plugin' || m.source.kind === 'runtime-context')) continue
      for (const part of m.content || []) {
        if (part && part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
      }
    }
    if (!texts.length) return 0
    const haystack = texts.join('\n').toLowerCase()
    if (haystack.length < 2) return 0

    const now = Date.now()
    let touched = 0
    const touchedTags = new Set()

    /** 把一句话切成 3~4 字的连续片段，用来判断「这条记忆是不是被提到了」 */
    const fragments = (text) => {
      const clean = String(text || '')
        .toLowerCase()
        .replace(/[\s，。；：、！？,.!?;:（）()「」【】\[\]"'`~～…—-]/g, '')
      const out = []
      for (let n = 3; n <= 4; n++) {
        for (let i = 0; i + n <= clean.length; i++) out.push(clean.slice(i, i + n))
      }
      return out
    }

    for (const entry of entries) {
      const probe = fragments(entry.text)
      if (!probe.length) continue
      const hitCount = probe.filter((w) => haystack.includes(w)).length
      // 至少命中一个 3~4 字段，且命中比例不算太低
      if (hitCount === 0) continue

      entry.reinforceCount = (Number(entry.reinforceCount) || 0) + 1
      entry.lastUsedAt = now
      touched += 1
      for (const tag of entry.tags || []) touchedTags.add(tag)
    }

    // 关联性：同一个标签下的其他记忆也跟着回暖（不计数，只刷新时间）
    if (touchedTags.size) {
      for (const entry of entries) {
        if (entry.lastUsedAt === now) continue
        const shared = (entry.tags || []).some((t) => touchedTags.has(t))
        if (shared) entry.lastUsedAt = now
      }
    }

    if (touched > 0) store.save(sessionId, mem)
    return touched
  }

  /**
   * 用用户指定的模型辅助判断「这轮有没有值得记的」。
   * 说明：这是可选的第二意见——关掉完全不影响本来的自我记忆逻辑。
   */
  async function judgeTurn(sessionId, messages) {
    const settings = loadSettings()
    if (!settings.judge.enabled || !settings.judge.provider || !settings.judge.model) return 0

    let llm
    try {
      llm = ctx.get('llm')
    } catch {
      llm = undefined
    }
    if (!llm || typeof llm.stream !== 'function') return 0

    const lines = []
    for (const m of messages || []) {
      const role = m?.role === 'user' ? '用户' : m?.role === 'assistant' ? '助手' : ''
      if (!role) continue
      for (const part of m.content || []) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          lines.push(`${role}：${clip(part.text, 600)}`)
        }
      }
    }
    if (lines.length === 0) return 0
    const convo = lines.slice(-8).join('\n')

    const prompt = [
      '下面是一段对话。判断其中有没有值得长期记住的信息。',
      '只看：用户明确的偏好 / 习惯 / 禁忌 / 称呼、约定或决定、不会再变的事实、角色设定。',
      '忽略：临时进度、一次性路径、寒暄、猜测。',
      '',
      '有就输出 JSON 数组，每项 {"text":"一句话说清一件事","kind":"fact|preference|decision|person"}；',
      '没有就只输出 NONE。不要解释，不要多余文字。',
      '',
      convo,
    ].join('\n')

    try {
      const stream = llm.stream({
        provider: settings.judge.provider,
        model: settings.judge.model,
        system: '你是记忆筛选器，只输出结果，不解释。',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0,
        maxTokens: settings.judge.maxTokens,
      })

      let out = ''
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta') out += chunk.text
        else if (chunk?.type === 'finish') break
      }

      const trimmed = out.trim()
      if (!trimmed || /^NONE$/i.test(trimmed)) return 0

      const matched = trimmed.match(/\[[\s\S]*\]/)
      if (!matched) return 0
      let items
      try {
        items = JSON.parse(matched[0])
      } catch {
        return 0
      }
      if (!Array.isArray(items) || items.length === 0) return 0

      const mem = store.load(sessionId)
      let added = 0
      for (const item of items.slice(0, 3)) {
        const text = String(item?.text ?? '').trim()
        if (text.length < 4) continue
        if (mem.entries.some((e) => e.text.trim() === text)) continue
        const kind = ENTRY_KINDS.includes(item?.kind) ? item.kind : 'fact'
        const entry = {
          id: randomUUID(),
          text,
          kind,
          tags: ['judge'],
          pinned: false,
          reinforceCount: 0,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        mem.entries.push(entry)
        if (!Array.isArray(mem.diary)) mem.diary = []
        mem.diary.push({ id: entry.id, text, kind, tags: entry.tags, at: entry.createdAt })
        added += 1
      }
      if (added > 0) {
        store.save(sessionId, mem)
        ctx.logger?.info?.(`[session-memory] 判断模型补记了 ${added} 条`)
      }
      return added
    } catch (error) {
      ctx.logger?.warn?.(`[session-memory] 判断模型调用失败: ${String(error?.message ?? error)}`)
      return 0
    }
  }

  ctx.on('agent/created', ({ agent } = {}) => {
    if (!agent?.ctx || !agent.id) return
    const sessionId = agent.id

    agent.ctx.on('agent/pre-step', async (payload, next) => {
      // 先做自动关联强化（不改变消息，只更新记忆强度）
      try {
        const turn = payload?.turn
        const turnKey = typeof turn === 'object' && turn !== null ? turn.number ?? turn.turn ?? JSON.stringify(turn).slice(0, 40) : turn
        if (turnKey !== undefined && lastAutoTurn.get(sessionId) !== turnKey) {
          lastAutoTurn.set(sessionId, turnKey)
          autoReinforce(sessionId, payload?.messages)

          // 用户指定了判断模型的话，按设定频率异步补一次判断（不阻塞对话）
          try {
            const settings = loadSettings()
            if (settings.judge.enabled) {
              const every = Math.max(1, settings.judge.everyTurns || 1)
              const tick = (judgeTick.get(sessionId) || 0) + 1
              if (tick >= every) {
                judgeTick.set(sessionId, 0)
                void judgeTurn(sessionId, payload?.messages)
              } else {
                judgeTick.set(sessionId, tick)
              }
            }
          } catch {
            /* 判断失败不影响主流程 */
          }
        }
      } catch (error) {
        ctx.logger?.warn?.(`[session-memory] 自动强化失败: ${String(error?.message ?? error)}`)
      }

      const decision = await next()
      if (!exclusiveFor(sessionId)) return decision
      if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
      const kept = decision.messages.filter((m) => !isBlockedMessageSource(m?.source, cfg.blockMessageSources))
      if (kept.length === decision.messages.length) return decision
      return { ...decision, messages: kept }
    })

    agent.ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const out = await next(assembly)
      if (!exclusiveFor(sessionId)) return out
      if (!out || !Array.isArray(out.sections)) return out
      const kept = out.sections.filter((section) => !cfg.blockSectionNames.includes(section?.name))
      if (kept.length === out.sections.length) return out
      return { ...out, sections: kept }
    })
  })

  // ---- 状态摘要（工具与面板共用） ----
  function summarize(sessionId) {
    const mem = withMemo(sessionId)
    return {
      sessionId,
      enabled: mem.enabled !== false,
      injectLimit: mem.injectLimit,
      entries: mem.entries.length,
      characters: mem.characters.length,
      pinned: mem.entries.filter((e) => e.pinned).length,
      file: store.fileOf(sessionId),
    }
  }

  // ---- 工具 1：session_memory ----
  const memoryTool = {
    name: 'session_memory',
    description:
      '本会话的记忆本子。每轮回复前先过一遍：这轮有没有值得长期保留的偏好、约定、决定、事实或角色设定？' +
      '有就 add 一条（一条只写一件事），没有就别记。只影响当前会话，别的会话看不到。' +
      '可选 action：help / add / list / update / remove / clear / status。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['help', 'add', 'list', 'update', 'remove', 'clear', 'status', 'reinforce', 'diary'],
          description: '要执行的操作',
        },
        text: { type: 'string', description: 'add/update 时的记忆正文；一条说清一件事，别把多件事挤在一条里' },
        kind: {
          type: 'string',
          enum: ENTRY_KINDS,
          description: '记忆类型：fact 事实 / preference 偏好 / decision 决定 / person 人物相关',
        },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签' },
        pinned: { type: 'boolean', description: '是否置顶（置顶的永远注入，不占普通配额）' },
        id: { type: 'string', description: 'remove/update 时的条目 id（可用 list 查）' },
        query: { type: 'string', description: 'list 时按关键字过滤' },
        limit: { type: 'number', description: 'list 返回条数，默认 50' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['ok', 'text'],
        additionalProperties: true,
      },
      render(_args, value) {
        const head = value?.ok === false ? '❌ ' : ''
        return [{ type: 'text', text: `${head}${value?.text ?? ''}`.trim() || '(空)' }]
      },
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id
      if (!sessionId) return { ok: false, text: '这个工具需要在会话里由 Agent 调用。' }
      const action = args?.action

      switch (action) {
        case 'help':
          return {
            ok: true,
            text: [
              '我是单会话记忆工具 session_memory，只记当前会话的事。',
              '· add {text, kind?, tags?, pinned?} —— 记住一条',
              '· list {query?, limit?} —— 看已记住的',
              '· update {id, text?/kind?/pinned?} —— 改一条',
              '· remove {id} —— 删一条',
              '· clear {} —— 清空本会话记忆（不可恢复）',
              '· status —— 看开关、条数、数据文件路径',
              '',
              '什么时候该记：用户明确的偏好、约定、决定、重要事实、人物设定。',
              '什么时候别记：临时进度、一次性的路径、猜的东西、用户没说的结论。',
            ].join('\n'),
          }

        case 'status': {
          const s = summarize(sessionId)
          const mem = withMemo(sessionId)
          const { full, brief, faded } = gradeEntries(mem)
          return {
            ok: true,
            text: [
              `本会话记忆：${s.enabled ? '开启' : '关闭'}`,
              `记忆 ${s.entries} 条（置顶 ${s.pinned}）　人物卡 ${s.characters} 张`,
              `当前注入：完整 ${full.length} · 压缩 ${brief.length} · 已淡出 ${faded.length}`,
              `日记 ${(mem.diary || []).length} 条原文（永不删）`,
              `生效上限 ${s.injectLimit} 条`,
              `数据文件：${s.file}`,
            ].join('\n'),
            data: s,
          }
        }

        case 'reinforce': {
          const mem = withMemo(sessionId)
          const id = String(args?.id ?? '')
          const target = mem.entries.find((e) => e.id === id)
          if (!target) return { ok: false, text: `没找到 id=${id} 的记忆。` }
          target.reinforceCount = (Number(target.reinforceCount) || 0) + 1
          target.lastUsedAt = Date.now()
          store.save(sessionId, mem)
          return {
            ok: true,
            text: `已复习「${clip(target.text, 40)}」，第 ${target.reinforceCount} 次，衰减速度减半。`,
            data: { id: target.id, reinforceCount: target.reinforceCount },
          }
        }

        case 'diary': {
          const mem = withMemo(sessionId)
          const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(500, args.limit)) : 30
          const items = (mem.diary || []).slice(-limit).reverse()
          if (!items.length) return { ok: true, text: '日记还是空的。', data: { diary: [] } }
          const lines = items.map((d) => {
            const when = new Date(d.at).toLocaleString('zh-CN')
            return `· ${when}　（${KIND_LABEL[d.kind] || '事实'}）${clip(d.text, 160)}`
          })
          return {
            ok: true,
            text: [`日记共 ${mem.diary.length} 条，显示最近 ${items.length} 条：`, ...lines].join('\n'),
            data: { diary: items, total: mem.diary.length },
          }
        }

        case 'add': {
          const text = String(args?.text ?? '').trim()
          if (!text) return { ok: false, text: 'text 不能为空。' }
          const mem = withMemo(sessionId)
          const entry = {
            id: randomUUID(),
            text,
            kind: ENTRY_KINDS.includes(args?.kind) ? args.kind : 'fact',
            tags: Array.isArray(args?.tags) ? args.tags.filter((t) => typeof t === 'string') : [],
            pinned: args?.pinned === true,
            reinforceCount: 0,
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          mem.entries.push(entry)

          // 日记：原文永久留一份，不参与衰减、也不进上下文
          if (!Array.isArray(mem.diary)) mem.diary = []
          mem.diary.push({
            id: entry.id,
            text,
            kind: entry.kind,
            tags: entry.tags,
            at: entry.createdAt,
          })

          store.save(sessionId, mem)
          return {
            ok: true,
            text: `已记住（${KIND_LABEL[entry.kind]}）：${clip(text, 120)}\n本会话现有 ${mem.entries.length} 条记忆。`,
            data: { id: entry.id, total: mem.entries.length },
          }
        }

        case 'list': {
          const mem = withMemo(sessionId)
          const q = String(args?.query ?? '').trim().toLowerCase()
          const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(500, args.limit)) : 50
          let items = mem.entries
          if (q) items = items.filter((e) => e.text.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)))
          const shown = items.slice(-limit)
          if (!shown.length) return { ok: true, text: `本会话没有${q ? '匹配' : ''}记忆。`, data: { entries: [] } }
          const lines = shown.map((e, i) => {
            const label = KIND_LABEL[e.kind] || '事实'
            return `${i + 1}. [${label}${e.pinned ? '·置顶' : ''}] ${clip(e.text, 200)}\n   id=${e.id}`
          })
          return {
            ok: true,
            text: [`本会话记忆 ${items.length} 条（显示最近 ${shown.length} 条）：`, ...lines].join('\n'),
            data: { entries: shown },
          }
        }

        case 'update': {
          const mem = withMemo(sessionId)
          const id = String(args?.id ?? '')
          const target = mem.entries.find((e) => e.id === id)
          if (!target) return { ok: false, text: `没找到 id=${id} 的记忆。` }
          if (typeof args?.text === 'string') target.text = args.text
          if (ENTRY_KINDS.includes(args?.kind)) target.kind = args.kind
          if (typeof args?.pinned === 'boolean') target.pinned = args.pinned
          if (Array.isArray(args?.tags)) target.tags = args.tags.filter((t) => typeof t === 'string')
          target.updatedAt = Date.now()
          store.save(sessionId, mem)
          return { ok: true, text: `已更新：${clip(target.text, 120)}`, data: { id: target.id } }
        }

        case 'remove': {
          const mem = withMemo(sessionId)
          const id = String(args?.id ?? '')
          const before = mem.entries.length
          mem.entries = mem.entries.filter((e) => e.id !== id)
          if (mem.entries.length === before) return { ok: false, text: `没找到 id=${id} 的记忆。` }
          store.save(sessionId, mem)
          return { ok: true, text: `已删除一条，剩 ${mem.entries.length} 条。`, data: { total: mem.entries.length } }
        }

        case 'clear': {
          const mem = withMemo(sessionId)
          const n = mem.entries.length
          mem.entries = []
          store.save(sessionId, mem)
          return { ok: true, text: `已清空本会话的 ${n} 条记忆（人物卡保留）。`, data: { cleared: n } }
        }

        default:
          return { ok: false, text: `未知 action：${action}。用 action=help 看可用操作。` }
      }
    },
  }

  // ---- 工具 2：session_card（人物卡） ----
  const cardTool = {
    name: 'session_card',
    description:
      '本会话的人物卡：给会话里出现的人物建档（姓名、身份关系、外貌、性格、背景、口吻）。只影响当前会话。可选 action：help / add / list / get / update / remove。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['help', 'add', 'list', 'get', 'update', 'remove'],
          description: '要执行的操作',
        },
        name: { type: 'string', description: '人物名（add 必填）' },
        alias: { type: 'string', description: '别称/昵称' },
        role: { type: 'string', description: '身份或与用户的关系' },
        appearance: { type: 'string', description: '外貌' },
        personality: { type: 'string', description: '性格' },
        background: { type: 'string', description: '背景经历' },
        speech: { type: 'string', description: '口吻、说话方式、口癖' },
        notes: { type: 'string', description: '其他备注' },
        id: { type: 'string', description: 'get/update/remove 时的卡 id' },
        query: { type: 'string', description: 'list 时按名字过滤' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['ok', 'text'],
        additionalProperties: true,
      },
      render(_args, value) {
        const head = value?.ok === false ? '❌ ' : ''
        return [{ type: 'text', text: `${head}${value?.text ?? ''}`.trim() || '(空)' }]
      },
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id
      if (!sessionId) return { ok: false, text: '这个工具需要在会话里由 Agent 调用。' }
      const action = args?.action

      switch (action) {
        case 'help':
          return {
            ok: true,
            text: [
              '我是人物卡工具 session_card，给当前会话的人物建档。',
              '· add {name, alias?, role?, appearance?, personality?, background?, speech?, notes?}',
              '· list {query?} —— 看所有卡',
              '· get {id|name} —— 看一张卡的全文',
              '· update {id|name, ...字段} —— 改',
              '· remove {id|name} —— 删',
              '',
              '卡是结构化人设，会被注入到本会话的上下文里；跟 session_memory 的自由文本互补。',
            ].join('\n'),
          }

        case 'list': {
          const mem = withMemo(sessionId)
          const q = String(args?.query ?? '').trim().toLowerCase()
          const items = q
            ? mem.characters.filter((c) => c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q))
            : mem.characters
          if (!items.length) return { ok: true, text: '本会话还没有人物卡。', data: { characters: [] } }
          const lines = items.map((c, i) => {
            const bits = [c.role, c.personality].filter(Boolean).join(' · ')
            return `${i + 1}. ${c.name}${c.alias ? `（${c.alias}）` : ''}${bits ? ` — ${clip(bits, 60)}` : ''}\n   id=${c.id}`
          })
          return { ok: true, text: [`本会话人物卡 ${items.length} 张：`, ...lines].join('\n'), data: { characters: items } }
        }

        case 'get': {
          const mem = withMemo(sessionId)
          const card = findCard(mem, args)
          if (!card) return { ok: false, text: '没找到这张卡。' }
          const lines = [`${card.name}${card.alias ? `（${card.alias}）` : ''}`]
          for (const [key, label] of CARD_FIELDS) {
            if (key === 'name' || key === 'alias') continue
            if (card[key]) lines.push(`${label}：${card[key]}`)
          }
          return { ok: true, text: lines.join('\n'), data: { character: card } }
        }

        case 'add': {
          const cardName = String(args?.name ?? '').trim()
          if (!cardName) return { ok: false, text: 'name 不能为空。' }
          const mem = withMemo(sessionId)
          const card = {
            id: randomUUID(),
            name: cardName,
            alias: text18(args?.alias),
            role: text18(args?.role),
            appearance: text18(args?.appearance),
            personality: text18(args?.personality),
            background: text18(args?.background),
            speech: text18(args?.speech),
            notes: text18(args?.notes),
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          mem.characters.push(card)
          store.save(sessionId, mem)
          return {
            ok: true,
            text: `已建立人物卡：${card.name}。本会话现有 ${mem.characters.length} 张卡。`,
            data: { id: card.id, total: mem.characters.length },
          }
        }

        case 'update': {
          const mem = withMemo(sessionId)
          const card = findCard(mem, args)
          if (!card) return { ok: false, text: '没找到这张卡。' }
          for (const [key] of CARD_FIELDS) {
            if (typeof args?.[key] === 'string') card[key] = args[key]
          }
          if (typeof args?.pinned === 'boolean') card.pinned = args.pinned
          card.updatedAt = Date.now()
          store.save(sessionId, mem)
          return { ok: true, text: `已更新人物卡：${card.name}。`, data: { id: card.id } }
        }

        case 'remove': {
          const mem = withMemo(sessionId)
          const card = findCard(mem, args)
          if (!card) return { ok: false, text: '没找到这张卡。' }
          mem.characters = mem.characters.filter((c) => c.id !== card.id)
          store.save(sessionId, mem)
          return { ok: true, text: `已删除人物卡：${card.name}。剩 ${mem.characters.length} 张。`, data: { total: mem.characters.length } }
        }

        default:
          return { ok: false, text: `未知 action：${action}。用 action=help 看可用操作。` }
      }
    },
  }

  function findCard(mem, args) {
    const id = String(args?.id ?? '').trim()
    if (id) return mem.characters.find((c) => c.id === id) || null
    const wanted = String(args?.name ?? '').trim().toLowerCase()
    if (!wanted) return null
    return mem.characters.find((c) => c.name.toLowerCase() === wanted || c.alias.toLowerCase() === wanted) || null
  }

  ctx.effect(() => ctx.tools.register(memoryTool))
  ctx.effect(() => ctx.tools.register(cardTool))

  // ---- 工具 3：session_mood（原 dsh-session-mood）----
  const moodTool = {
    name: 'session_mood',
    description:
      '本会话的情绪与性格：多维情绪强度（0-100，会随对话变化）+ 自己在对话里长出来的性格标签。只影响当前会话。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['help', 'get', 'set', 'adjust', 'personality', 'history'],
          description: '要执行的操作',
        },
        emotion: { type: 'string', enum: EMOTION_IDS, description: '单个情绪 id' },
        value: { type: 'number', description: 'set 时的目标值（0-100）' },
        delta: { type: 'number', description: 'adjust 时的增减量，比如 -20' },
        emotions: {
          type: 'object',
          description: '一次调多个情绪，形如 { "happy": 70, "calm": 20 }',
          additionalProperties: { type: 'number' },
        },
        reason: { type: 'string', description: '为什么变（会写进历史）' },
        text: { type: 'string', description: '自定义性格描述（一句话）' },
        addTag: { type: 'string', description: '给自己贴一个性格标签，会一直累积' },
        removeTag: { type: 'string', description: '去掉一个自己贴过的标签' },
        limit: { type: 'number', description: 'history 返回条数，默认 10' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['ok', 'text'],
        additionalProperties: true,
      },
      render(_args, value) {
        const head = value?.ok === false ? '❌ ' : ''
        return [{ type: 'text', text: `${head}${value?.text ?? ''}`.trim() || '(空)' }]
      },
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id
      if (!sessionId) return { ok: false, text: '这个工具需要在会话里由 Agent 调用。' }
      const action = args?.action
      const mem = withMemo(sessionId)
      const mood = mem.mood

      const applyMoodChanges = (next, by, reason) => {
        const changed = {}
        for (const [id, raw] of Object.entries(next || {})) {
          if (!EMOTION_IDS.includes(id)) continue
          const v = clampEmotion(raw)
          if (mood.emotions[id] !== v) {
            changed[id] = { from: mood.emotions[id], to: v }
            mood.emotions[id] = v
          }
        }
        if (Object.keys(changed).length === 0) return changed
        mood.needsJudge = false
        mood.history.push({
          at: Date.now(),
          by: by === 'ai' ? 'ai' : 'user',
          reason: typeof reason === 'string' ? reason.slice(0, 200) : '',
          changes: changed,
        })
        return changed
      }

      switch (action) {
        case 'help':
          return {
            ok: true,
            text: [
              '我是情绪工具 session_mood（已并进单会话记忆插件）。',
              '· get —— 看当前性格和情绪',
              '· set {emotion, value} 或 {emotions:{...}} —— 直接设',
              '· adjust {emotion, delta} —— 在现有基础上加减',
              '· personality {text?, addTag?, removeTag?} —— 改性格 / 贴标签',
              '· history {limit?} —— 看变化记录',
            ].join('\n'),
          }

        case 'get': {
          const tags = mood.personality.tags || []
          const tops = EMOTIONS.map((e) => ({ ...e, value: mood.emotions[e.id] ?? 0 }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 3)
          return {
            ok: true,
            text: [
              `性格：${mood.personality.text || '（未写）'}${tags.length ? `　标签：${tags.map((t) => `#${t}`).join(' ')}` : '　（还没有标签）'}`,
              mood.needsJudge ? '情绪：还没定（等你在对话里判断一次）' : `情绪：${EMOTIONS.map((e) => `${e.label} ${mood.emotions[e.id]}`).join('　')}`,
              `最强：${tops.map((t) => `${t.label} ${t.value}`).join('、')}`,
            ].join('\n'),
            data: { personality: mood.personality, emotions: mood.emotions, needsJudge: mood.needsJudge },
          }
        }

        case 'set': {
          let next = {}
          if (args?.emotion && Number.isFinite(args?.value)) next = { [args.emotion]: args.value }
          else if (args?.emotions && typeof args.emotions === 'object') next = args.emotions
          if (Object.keys(next).length === 0) return { ok: false, text: '要给 emotion+value，或者 emotions 对象。' }
          const changed = applyMoodChanges(next, 'ai', args?.reason)
          if (Object.keys(changed).length === 0) return { ok: true, text: '情绪没变化。' }
          store.save(sessionId, mem)
          const parts = Object.entries(changed).map(([id, v]) => `${EMOTION_BY_ID.get(id)?.label ?? id} ${v.from}→${v.to}`)
          return { ok: true, text: `情绪已更新：${parts.join('，')}` }
        }

        case 'adjust': {
          if (!args?.emotion || !Number.isFinite(args?.delta)) return { ok: false, text: '要给 emotion 和 delta。' }
          const target = clampEmotion((mood.emotions[args.emotion] ?? 0) + Number(args.delta))
          const changed = applyMoodChanges({ [args.emotion]: target }, 'ai', args?.reason)
          if (Object.keys(changed).length === 0) {
            return { ok: true, text: `「${EMOTION_BY_ID.get(args.emotion)?.label}」已经是 ${target}，没变化。` }
          }
          store.save(sessionId, mem)
          const v = changed[args.emotion]
          return { ok: true, text: `${EMOTION_BY_ID.get(args.emotion)?.label} ${v.from}→${v.to}` }
        }

        case 'personality': {
          let note = ''
          if (typeof args?.text === 'string') mood.personality.text = args.text
          if (typeof args?.addTag === 'string') {
            const tag = args.addTag.trim().slice(0, 20)
            if (tag && !mood.personality.tags.includes(tag)) {
              if (mood.personality.tags.length >= 20) mood.personality.tags.shift()
              mood.personality.tags.push(tag)
              note = `，加了标签 #${tag}`
            }
          }
          if (typeof args?.removeTag === 'string') {
            const tag = args.removeTag.trim()
            const before = mood.personality.tags.length
            mood.personality.tags = mood.personality.tags.filter((t) => t !== tag)
            if (mood.personality.tags.length !== before) note = `，去掉了标签 #${tag}`
          }
          mood.history.push({
            at: Date.now(),
            by: 'ai',
            reason: '改性格',
            changes: { personality: { from: '', to: mood.personality.tags.join(' ') } },
          })
          store.save(sessionId, mem)
          return {
            ok: true,
            text: `性格标签：${mood.personality.tags.length ? mood.personality.tags.map((t) => `#${t}`).join(' ') : '（空）'}${note}`,
          }
        }

        case 'history': {
          const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(50, args.limit)) : 10
          const items = mood.history.slice(-limit)
          if (!items.length) return { ok: true, text: '还没有情绪变化记录。' }
          const lines = items.map((h) => {
            const parts = Object.entries(h.changes || {})
              .map(([id, v]) => `${EMOTION_BY_ID.get(id)?.label ?? id} ${v.from}→${v.to}`)
              .join('，')
            return `· ${new Date(h.at).toLocaleString('zh-CN')}　${h.by === 'ai' ? 'AI' : '手动'}　${parts}${h.reason ? `（${h.reason}）` : ''}`
          })
          return { ok: true, text: ['最近的情绪变化：', ...lines].join('\n') }
        }

        default:
          return { ok: false, text: `未知 action：${action}，用 action=help 看可用操作。` }
      }
    },
  }

  ctx.effect(() => ctx.tools.register(moodTool))

  // ---- 提示词注入：按会话取自己的记忆 ----
  // text 是函数：每次组装重读，开关一改下一轮立刻生效。
  const promptContext = {
    name: 'session-memory',
    order: cfg.injectOrder,
    text(context) {
      try {
        const sessionId = context?.agent?.id
        if (!sessionId) return ''
        const mem = store.peek(sessionId)
        return renderMemoryBlock(mem, cfg)
      } catch {
        return ''
      }
    },
  }

  try {
    ctx.inject(['systemPrompt'], (spCtx) => {
      try {
        spCtx.systemPrompt.context(promptContext)
        ctx.logger?.info?.('[session-memory] 记忆注入已挂上')
      } catch (error) {
        ctx.logger?.warn?.('[session-memory] 注入挂载失败: ' + String(error?.message ?? error))
      }
    })
  } catch (error) {
    ctx.logger?.warn?.('[session-memory] systemPrompt 服务不可用: ' + String(error?.message ?? error))
  }

  // ---- 面板 API ----
  const API_PATH = '/dsh-session-memory-api'
  const api = { mounted: false, path: API_PATH, reason: 'pending' }

  function panelState(sessionId) {
    const mem = store.peek(sessionId)
    const mood = mem.mood || emptyMood()
    return {
      version: { running: PLUGIN_VERSION },
      sessionId,
      enabled: mem.enabled !== false,
      injectLimit: mem.injectLimit,
      entries: mem.entries.slice().reverse(),
      characters: mem.characters.slice(),
      chatIntent: Number.isFinite(mem.chatIntent) ? mem.chatIntent : null,
      exclusive: typeof mem.exclusive === 'boolean' ? mem.exclusive : null,
      exclusiveEffective: exclusiveFor(sessionId),
      defaultExclusive: loadSettings().defaultExclusive,
      // 情绪（原 dsh-session-mood）
      mood: {
        enabled: mood.enabled !== false,
        personality: { text: mood.personality.text, tags: mood.personality.tags || [] },
        emotions: mood.emotions,
        needsJudge: mood.needsJudge === true,
        history: mood.history.slice(-10).reverse(),
      },
      emotionsCatalog: EMOTIONS,
      file: store.fileOf(sessionId),
      kinds: ENTRY_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] })),
    }
  }

  /** 当前还开着的会话都用哪些工作区（用来给新会话挑一个合理默认值）。 */
  function liveSessionCwds() {
    const out = []
    try {
      const agents = ctx.get('agents')
      const sessions = ctx.get('sessions')
      for (const agent of agents?.list?.() || []) {
        try {
          const cwd = sessions?.get?.(agent.id)?.header?.cwd
          if (typeof cwd === 'string' && cwd.trim()) out.push(cwd.trim())
        } catch {
          /* 单个会话取不到就跳过 */
        }
      }
    } catch {
      /* 服务不可用就走兜底 */
    }
    return [...new Set(out)]
  }

  /**
   * 新会话该挂哪个工作区。
   * 注意：卡片库是全局面板，拿不到「当前会话」，所以这里不能瞎退到 process.cwd()
   * ——那会把会话挂进 DSH 的 profile 目录。优先用调用方显式给的，其次用还开着的会话。
   */
  function resolveCwd(explicit) {
    const given = typeof explicit === 'string' ? explicit.trim() : ''
    if (given && (/^[A-Za-z]:[\\/]/.test(given) || given.startsWith('/'))) return given
    const live = liveSessionCwds()
    if (live.length) return live[0]
    return process.cwd()
  }

  // 不依赖「当前会话」的全局操作（设置页、左侧「角色卡开场」会用）
  const GLOBAL_ACTIONS = [
    'getSettings',
    'setDefaultExclusive',
    'setJudge',
    'listModels',
    'listAllCards',
    'listLibrary',
    'suggestCwd',
    'saveLibraryCard',
    'deleteLibraryCard',
    'importLibrary',
    'parseCards',
    'createSessionWithCard',
  ]

  async function handleApi(payload) {
    const action = String(payload?.action ?? 'state')
    const sessionId = String(payload?.sessionId ?? '').trim()
    if (!GLOBAL_ACTIONS.includes(action) && !sessionId) {
      return { ok: false, text: `缺少 sessionId（action=${action}）` }
    }

    switch (action) {
      case 'state':
        return { ok: true, data: panelState(sessionId) }

      case 'toggle': {
        const mem = store.load(sessionId)
        mem.enabled = payload.enabled === true
        store.save(sessionId, mem)
        return { ok: true, text: mem.enabled ? '已开启本会话记忆' : '已关闭本会话记忆', data: panelState(sessionId) }
      }

      // ---- 情绪（原 dsh-session-mood）----
      case 'toggleMood': {
        const mem = store.load(sessionId)
        memorMood(mem).enabled = payload.enabled === true
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'setEmotion': {
        const mem = store.load(sessionId)
        const mood = memorMood(mem)
        const next = {}
        if (payload?.emotion && Number.isFinite(payload?.value)) next[payload.emotion] = payload.value
        if (payload?.emotions && typeof payload.emotions === 'object') Object.assign(next, payload.emotions)
        let changed = 0
        for (const [id, raw] of Object.entries(next)) {
          if (!EMOTION_IDS.includes(id)) continue
          const v = clampEmotion(raw)
          if (mood.emotions[id] === v) continue
          mood.history.push({
            at: Date.now(),
            by: 'user',
            reason: '',
            changes: { [id]: { from: mood.emotions[id], to: v } },
          })
          mood.emotions[id] = v
          changed += 1
        }
        if (changed > 0) {
          mood.needsJudge = false
          store.save(sessionId, mem)
        }
        return { ok: true, data: panelState(sessionId) }
      }

      case 'setPersonality': {
        const mem = store.load(sessionId)
        const mood = memorMood(mem)
        if (typeof payload?.text === 'string') mood.personality.text = payload.text
        if (payload?.preset === undefined && typeof payload?.text !== 'string' && payload?.tag === undefined) {
          /* 什么也没给 */
        }
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'addTag': {
        const mem = store.load(sessionId)
        const mood = memorMood(mem)
        const tag = String(payload?.tag ?? '').trim().slice(0, 20)
        if (!tag) return { ok: false, text: '标签不能为空' }
        if (!mood.personality.tags.includes(tag)) {
          if (mood.personality.tags.length >= 20) mood.personality.tags.shift()
          mood.personality.tags.push(tag)
          store.save(sessionId, mem)
        }
        return { ok: true, text: `已加标签 #${tag}`, data: panelState(sessionId) }
      }

      case 'removeTag': {
        const mem = store.load(sessionId)
        const mood = memorMood(mem)
        const tag = String(payload?.tag ?? '').trim()
        const before = mood.personality.tags.length
        mood.personality.tags = mood.personality.tags.filter((t) => t !== tag)
        if (mood.personality.tags.length !== before) store.save(sessionId, mem)
        return {
          ok: true,
          text: mood.personality.tags.length === before ? '没找到这个标签' : `已去掉 #${tag}`,
          data: panelState(sessionId),
        }
      }

      case 'resetEmotions': {
        const mem = store.load(sessionId)
        const mood = memorMood(mem)
        mood.emotions = defaultEmotions()
        mood.needsJudge = true
        mood.history.push({
          at: Date.now(),
          by: 'user',
          reason: '重置，等 AI 重新判断',
          changes: { reset: { from: '', to: '' } },
        })
        store.save(sessionId, mem)
        return { ok: true, text: '已清空，下一轮会由 AI 重新判断当前情绪', data: panelState(sessionId) }
      }

      case 'setLimit': {
        const mem = store.load(sessionId)
        const n = Number(payload?.injectLimit)
        mem.injectLimit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.round(n))) : DEFAULT_CONFIG.defaultInjectLimit
        store.save(sessionId, mem)
        return { ok: true, text: `生效上限设为 ${mem.injectLimit} 条`, data: panelState(sessionId) }
      }

      case 'setExclusive': {
        const mem = store.load(sessionId)
        // 传 null 表示「跟随全局默认」
        if (payload?.exclusive === null || payload?.exclusive === undefined) {
          mem.exclusive = null
          store.save(sessionId, mem)
          return { ok: true, text: '本会话已恢复为「跟随全局默认」', data: panelState(sessionId) }
        }
        mem.exclusive = payload.exclusive === true
        store.save(sessionId, mem)
        return {
          ok: true,
          text: mem.exclusive ? '本会话已开启独占记忆：只保留这一套' : '本会话已关闭独占记忆',
          data: panelState(sessionId),
        }
      }

      case 'setDefaultExclusive': {
        const next = saveSettings({ defaultExclusive: payload?.defaultExclusive === true })
        return {
          ok: true,
          text: next.defaultExclusive ? '新会话将默认开启独占记忆' : '新会话不再默认独占',
          data: { settings: next },
        }
      }

      case 'getSettings':
        return { ok: true, data: { settings: loadSettings(), version: PLUGIN_VERSION } }

      // 辅助判断记忆的模型：开/关 + 指定 provider/model
      case 'setJudge': {
        const enable = payload?.enabled === true
        const provider = String(payload?.provider ?? '').trim()
        const model = String(payload?.model ?? '').trim()
        const next = saveSettings({
          judge: {
            enabled: enable,
            provider,
            model,
            maxTokens: Number(payload?.maxTokens) > 0 ? Math.min(2000, Math.round(Number(payload.maxTokens))) : 400,
            everyTurns:
              Number(payload?.everyTurns) >= 1
                ? Math.min(20, Math.round(Number(payload.everyTurns)))
                : loadSettings().judge.everyTurns,
          },
        })
        // 允许「先开、后选模型」：没选好时明确说不生效，而不是把开关弹回去
        const ready = Boolean(provider && model)
        return {
          ok: true,
          text: !enable
            ? '判断模型已关闭'
            : ready
              ? `判断模型已开启：${provider} / ${model}`
              : '已打开，但还没选模型，暂不生效',
          data: { settings: next, ready: enable && ready },
        }
      }

      // 给设置页列可选的 provider / model
      case 'listModels': {
        let llm
        try {
          llm = ctx.get('llm')
        } catch {
          llm = undefined
        }
        if (!llm) return { ok: false, text: '宿主没有 llm 服务' }
        const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        const out = []
        for (const p of providers) {
          const id = typeof p === 'string' ? p : p?.id ?? p?.provider ?? ''
          if (!id) continue
          let models = []
          try {
            if (typeof llm.listModels === 'function') {
              const raw = await llm.listModels(id)
              models = (raw || []).map((m) => (typeof m === 'string' ? m : m?.id ?? m?.model ?? '')).filter(Boolean)
            }
          } catch {
            models = []
          }
          out.push({ provider: id, label: (typeof p === 'object' && p?.label) || id, models })
        }
        return { ok: true, data: { providers: out } }
      }

      case 'setChatIntent': {
        const mem = store.load(sessionId)
        if (payload?.chatIntent === null || payload?.chatIntent === undefined || payload?.chatIntent === '') {
          mem.chatIntent = null
          store.save(sessionId, mem)
          return { ok: true, text: '群聊回复意向已恢复默认（不再干预）', data: panelState(sessionId) }
        }
        const n = Number(payload.chatIntent)
        if (!Number.isFinite(n)) return { ok: false, text: '意向值必须是 0~100 的数字' }
        mem.chatIntent = Math.max(0, Math.min(100, Math.round(n)))
        store.save(sessionId, mem)
        return { ok: true, text: `群聊回复意向设为 ${mem.chatIntent}%`, data: panelState(sessionId) }
      }

      case 'addEntry': {
        const text = String(payload?.text ?? '').trim()
        if (!text) return { ok: false, text: '记忆内容不能为空' }
        const mem = store.load(sessionId)
        mem.entries.push({
          id: randomUUID(),
          text,
          kind: ENTRY_KINDS.includes(payload?.kind) ? payload.kind : 'fact',
          tags: [],
          pinned: payload?.pinned === true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'removeEntry': {
        const mem = store.load(sessionId)
        mem.entries = mem.entries.filter((e) => e.id !== payload?.id)
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'clearEntries': {
        const mem = store.load(sessionId)
        mem.entries = []
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'addCard': {
        const cardName = String(payload?.name ?? '').trim()
        if (!cardName) return { ok: false, text: '人物名不能为空' }
        const mem = store.load(sessionId)
        mem.characters.push({
          id: randomUUID(),
          name: cardName,
          alias: text18(payload?.alias),
          role: text18(payload?.role),
          appearance: text18(payload?.appearance),
          personality: text18(payload?.personality),
          background: text18(payload?.background),
          speech: text18(payload?.speech),
          notes: text18(payload?.notes),
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'updateCard': {
        const mem = store.load(sessionId)
        const card = mem.characters.find((c) => c.id === payload?.id)
        if (!card) return { ok: false, text: '没找到这张卡' }
        for (const [key] of CARD_FIELDS) {
          if (typeof payload?.[key] === 'string') card[key] = payload[key]
        }
        card.updatedAt = Date.now()
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'removeCard': {
        const mem = store.load(sessionId)
        mem.characters = mem.characters.filter((c) => c.id !== payload?.id)
        store.save(sessionId, mem)
        return { ok: true, data: panelState(sessionId) }
      }

      case 'export': {
        const mem = store.peek(sessionId)
        const format = payload?.format === 'json' ? 'json' : 'md'
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const content = format === 'json' ? toJson(mem) : toMarkdown(mem)
        return {
          ok: true,
          data: {
            filename: `session-memory-${safeName(sessionId)}-${stamp}.${format}`,
            mime: format === 'json' ? 'application/json' : 'text/markdown',
            content,
          },
        }
      }

      case 'exportCards': {
        const mem = store.peek(sessionId)
        const only = String(payload?.cardId ?? '')
        const cards = only ? mem.characters.filter((c) => c.id === only) : mem.characters
        if (only && !cards.length) return { ok: false, text: '没找到这张卡' }
        const format = payload?.format === 'json' ? 'json' : 'md'
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const base = only ? safeName(cards[0].name) : 'characters'
        const content =
          format === 'json'
            ? cardsToJson(cards)
            : cardsToMarkdown(cards, only ? `${cards[0].name} 人物卡` : '本会话人物卡')
        return {
          ok: true,
          data: {
            filename: `session-cards-${base}-${stamp}.${format}`,
            mime: format === 'json' ? 'application/json' : 'text/markdown',
            content,
          },
        }
      }

      case 'importCards': {
        const rawCards = payload?.cards
        let cards = []
        let source = 'inline'

        if (Array.isArray(rawCards)) {
          cards = rawCards.map((c) => buildCardFromObject(c)).filter((c) => c.name)
        } else {
          const content = String(payload?.content ?? '')
          const parsed = parseCardsFromText(content)
          cards = parsed.cards
          source = parsed.source
          if (!cards.length) {
            return {
              ok: false,
              text:
                source === 'text'
                  ? '没从内容里认出任何人物卡。文本模式需要「姓名：xxx」「外貌：xxx」这样的键值行。'
                  : '没从内容里认出任何人物卡。',
            }
          }
        }

        if (!cards.length) return { ok: false, text: '没有可导入的人物卡。' }
        if (cards.length > IMPORT_CARD_LIMIT) cards = cards.slice(0, IMPORT_CARD_LIMIT)

        const mem = store.load(sessionId)
        let added = 0
        let updated = 0
        for (const incoming of cards) {
          const existing = mem.characters.find(
            (c) => c.name && c.name.toLowerCase().trim() === incoming.name.toLowerCase().trim(),
          )
          if (existing) {
            for (const [field] of CARD_FIELDS) {
              if (incoming[field]) existing[field] = incoming[field]
            }
            existing.updatedAt = Date.now()
            updated += 1
          } else {
            mem.characters.push({
              id: randomUUID(),
              name: incoming.name,
              alias: incoming.alias || '',
              role: incoming.role || '',
              appearance: incoming.appearance || '',
              personality: incoming.personality || '',
              background: incoming.background || '',
              speech: incoming.speech || '',
              notes: incoming.notes || '',
              pinned: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
            added += 1
          }
        }
        store.save(sessionId, mem)

        return {
          ok: true,
          text: `导入完成：新增 ${added} 张，更新 ${updated} 张（识别格式：${source}）`,
          data: { added, updated, source, total: mem.characters.length, state: panelState(sessionId) },
        }
      }

      // ---- 全局角色卡库 ----
      case 'listLibrary': {
        const lib = loadLibrary()
        const cards = [...lib.cards].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        return { ok: true, data: { cards, version: PLUGIN_VERSION, file: libraryFile } }
      }

      case 'saveLibraryCard': {
        const saved = upsertLibraryCard(payload?.card)
        if (!saved) return { ok: false, text: '角色卡缺少姓名' }
        return {
          ok: true,
          text: saved.updated ? `已更新「${saved.card.name}」` : `已新建「${saved.card.name}」`,
          data: { card: saved.card, cards: loadLibrary().cards },
        }
      }

      case 'deleteLibraryCard': {
        const id = String(payload?.id ?? '')
        const lib = loadLibrary()
        const target = lib.cards.find((c) => c.id === id)
        if (!target) return { ok: false, text: '没找到这张卡' }
        saveLibrary(lib.cards.filter((c) => c.id !== id))
        return { ok: true, text: `已删除「${target.name}」`, data: { cards: loadLibrary().cards } }
      }

      case 'importLibrary': {
        const parsed = parseCardsFromText(String(payload?.content ?? ''))
        if (!parsed.cards.length) {
          return {
            ok: false,
            text:
              parsed.source === 'text'
                ? '没认出角色卡。文本模式需要「姓名：xxx」「外貌：xxx」这样的键值行。'
                : '没认出角色卡。',
          }
        }
        let added = 0
        let updated = 0
        for (const card of parsed.cards.slice(0, 200)) {
          const saved = upsertLibraryCard(card)
          if (!saved) continue
          if (saved.updated) updated += 1
          else added += 1
        }
        return {
          ok: true,
          text: `入库完成：新增 ${added} 张，更新 ${updated} 张`,
          data: { added, updated, cards: loadLibrary().cards },
        }
      }

      // 新会话用哪个工作区：把还开着的会话用过的列出来，让面板给个选项
      case 'suggestCwd': {
        return {
          ok: true,
          data: { cwds: liveSessionCwds(), current: process.cwd() },
        }
      }

      // 跨会话汇总所有已有人物卡（兼容旧数据，左侧「角色卡开场」用）
      case 'listAllCards': {
        const sessions = store.listSessions()
        const cards = []
        for (const s of sessions) {
          for (const c of s.characters || []) {
            cards.push({ ...c, fromSession: s.sessionId })
          }
        }
        cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        return { ok: true, data: { cards } }
      }

      // 只解析、不落盘：左侧「角色卡开场」导入时先预览
      case 'parseCards': {
        const parsed = parseCardsFromText(String(payload?.content ?? ''))
        if (!parsed.cards.length) {
          return {
            ok: false,
            text:
              parsed.source === 'text'
                ? '没认出角色卡。文本模式需要「姓名：xxx」「外貌：xxx」这样的键值行。'
                : '没认出角色卡。',
          }
        }
        return { ok: true, data: { cards: parsed.cards, source: parsed.source } }
      }

      // 把一张卡挂到「当前这个会话」（不新建会话）
      case 'applyCardToSession': {
        let incoming = payload?.card
        if ((!incoming || typeof incoming !== 'object') && payload?.cardId) {
          const lib = loadLibrary()
          incoming = lib.cards.find((c) => c.id === String(payload.cardId))
        }
        if (!incoming || typeof incoming !== 'object') return { ok: false, text: '缺少角色卡' }
        const card = buildCardFromObject(incoming)
        if (!card.name) return { ok: false, text: '角色卡缺少姓名' }

        // 挂载即入库：不用再单独点「存进卡库」
        try {
          upsertLibraryCard(incoming)
        } catch (error) {
          ctx.logger?.warn?.(`[session-memory] 入库失败（不影响挂载）: ${String(error?.message ?? error)}`)
        }

        const mem = store.load(sessionId)
        const same = mem.characters.find((c) => c.name.trim().toLowerCase() === card.name.trim().toLowerCase())
        if (same) {
          Object.assign(same, {
            alias: card.alias || same.alias || '',
            role: card.role || same.role || '',
            appearance: card.appearance || same.appearance || '',
            personality: card.personality || same.personality || '',
            background: card.background || same.background || '',
            speech: card.speech || same.speech || '',
            notes: card.notes || same.notes || '',
            pinned: true,
            updatedAt: Date.now(),
          })
        } else {
          mem.characters.push({
            id: randomUUID(),
            name: card.name,
            alias: card.alias || '',
            role: card.role || '',
            appearance: card.appearance || '',
            personality: card.personality || '',
            background: card.background || '',
            speech: card.speech || '',
            notes: card.notes || '',
            pinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        }

        // 同一条开场设定不重复写
        const marker = `本会话的角色是「${card.name}」`
        if (!mem.entries.some((e) => typeof e.text === 'string' && e.text.includes(marker))) {
          mem.entries.push({
            id: randomUUID(),
            text: `${marker}，请以这个角色的人设和口吻来回应。`,
            kind: 'decision',
            tags: ['角色扮演', '开场设定'],
            pinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        }
        store.save(sessionId, mem)

        // 挂上之后要不要让角色先开口，由调用方决定（默认不打扰）
        let kicked = false
        if (payload?.kick === true) {
          try {
            const agents = ctx.get('agents')
            const agent = agents?.get?.(sessionId)
            if (agent && typeof agent.followup === 'function') {
              agent.followup({
                id: randomUUID(),
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text:
                      `【角色扮演】从现在起你是「${card.name}」，` +
                      `用这个角色的身份、语气和性格来回应接下来的对话。先自然地说一句开场白。`,
                  },
                ],
                source: { kind: 'user' },
              })
              kicked = true
            }
          } catch (error) {
            ctx.logger?.warn?.(`[session-memory] 角色开场消息没发出去: ${String(error?.message ?? error)}`)
          }
        }

        return {
          ok: true,
          text:
            `已把「${card.name}」挂到当前会话${same ? '（同名卡已更新）' : ''}` +
            (kicked ? '，角色已主动开口' : ''),
          data: { ...panelState(sessionId), kicked },
        }
      }

      // 用一张角色卡开一个新会话（传 card，或只传 cardId 从卡库里取）
      case 'createSessionWithCard': {
        let incoming = payload?.card
        if ((!incoming || typeof incoming !== 'object') && payload?.cardId) {
          const lib = loadLibrary()
          incoming = lib.cards.find((c) => c.id === String(payload.cardId))
        }
        if (!incoming || typeof incoming !== 'object') return { ok: false, text: '缺少角色卡' }
        const card = buildCardFromObject(incoming)
        if (!card.name) return { ok: false, text: '角色卡缺少姓名' }

        let agents
        try {
          agents = ctx.get('agents')
        } catch (error) {
          agents = undefined
        }
        if (!agents || typeof agents.create !== 'function') {
          return { ok: false, text: '宿主没有 agents.create，无法新建会话' }
        }

        const newId = `sess-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const cwd = resolveCwd(payload?.cwd)

        try {
          await agents.create({ sessionId: newId, meta: { cwd } })
        } catch (error) {
          return { ok: false, text: `创建会话失败：${String(error?.message ?? error)}` }
        }

        // 会话名直接用角色卡的名字
        let titled = false
        try {
          const sessions = ctx.get('sessions')
          const session = sessions?.get?.(newId)
          const titleSvc = ctx.get('sessionTitle')
          if (session) {
            if (titleSvc && typeof titleSvc.rename === 'function') {
              titleSvc.rename(session, card.name)
              titled = true
            } else if (typeof session.append === 'function') {
              session.append('session/title', {
                title: card.name,
                messageSeqs: [],
                source: { kind: 'user' },
              })
              titled = true
            }
          }
        } catch (error) {
          ctx.logger?.warn?.(`[session-memory] 设置会话标题失败: ${String(error?.message ?? error)}`)
        }

        try {
          const mem = store.load(newId)
          mem.characters.push({
            id: randomUUID(),
            name: card.name,
            alias: card.alias || '',
            role: card.role || '',
            appearance: card.appearance || '',
            personality: card.personality || '',
            background: card.background || '',
            speech: card.speech || '',
            notes: card.notes || '',
            pinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          mem.entries.push({
            id: randomUUID(),
            text: `本会话的角色是「${card.name}」，请以这个角色的人设和口吻来回应。`,
            kind: 'decision',
            tags: ['角色扮演', '开场设定'],
            pinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          store.save(newId, mem)
        } catch (error) {
          return {
            ok: false,
            text: `会话已建好（${newId}），但写入角色卡失败：${String(error?.message ?? error)}`,
            data: { sessionId: newId },
          }
        }

        return {
          ok: true,
          text: `已创建新会话「${card.name}」${titled ? '' : '（会话名没设上，可手动改名）'}`,
          data: { sessionId: newId, cardName: card.name, cwd, titled },
        }
      }

      case 'diag':
        return {
          ok: true,
          text: [
            `插件版本：${PLUGIN_VERSION}`,
            `面板 API：${api.mounted ? 'mounted' : api.reason} (${API_PATH})`,
            `数据目录：${store.root}`,
            `本会话文件：${store.fileOf(sessionId)}（存在=${existsSync(store.fileOf(sessionId))}）`,
          ].join('\n'),
          data: panelState(sessionId),
        }

      default:
        return { ok: false, text: `未知 action：${action}` }
    }
  }

  function mountApi(webServer) {
    if (api.mounted) return
    if (!webServer || typeof webServer.register !== 'function') {
      api.reason = 'webserver-unavailable'
      return
    }
    api.mounted = true
    api.reason = 'mounted'
    try {
      // 注意：register 收的是 { kind, path, handler } 配置对象，
      // 不是 register(path, handler)。传错的话路由虽然存在但没人处理，前端只会拿到 405。
      ctx.effect(() =>
        webServer.register({
          kind: 'exact',
          path: API_PATH,
          async handler(req, res) {
            const send = (code, body) => {
              res.writeHead(code, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
              })
              res.end(JSON.stringify(body))
            }
            try {
              if (req.method === 'GET') {
                const url = new URL(req.url || '/', 'http://localhost')
                const payload = Object.fromEntries(url.searchParams.entries())
                send(200, await handleApi(payload))
                return
              }
              if (req.method === 'POST') {
                const chunks = []
                for await (const chunk of req) chunks.push(chunk)
                const raw = Buffer.concat(chunks).toString('utf8')
                let payload = {}
                try {
                  payload = raw ? JSON.parse(raw) : {}
                } catch {
                  send(400, { ok: false, text: '请求体不是合法 JSON' })
                  return
                }
                send(200, await handleApi(payload))
                return
              }
              send(405, { ok: false, text: '只接受 GET / POST' })
            } catch (error) {
              send(500, { ok: false, text: String(error?.message ?? error) })
            }
          },
        }),
      )
    } catch (error) {
      api.mounted = false
      api.reason = 'register-failed: ' + String(error?.message ?? error)
      ctx.logger?.warn?.('[session-memory] 面板 API 挂载失败: ' + api.reason)
    }
  }

  try {
    const now = ctx.get('webServer')
    if (now && typeof now.register === 'function') mountApi(now)
    else api.reason = 'waiting-for-webserver'
  } catch (error) {
    api.reason = 'lookup-failed: ' + String(error?.message ?? error)
  }

  if (!api.mounted) {
    try {
      ctx.inject(['webServer'], (webCtx) => mountApi(webCtx.webServer))
    } catch (error) {
      api.reason = 'inject-failed: ' + String(error?.message ?? error)
    }
  }

  store.ensureDirs()

  ctx.logger?.info?.('[session-memory] 单会话记忆已就绪；API: ' + api.reason + ' (' + API_PATH + ')')
}
