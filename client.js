/* 单会话记忆 · 会话顶部工具栏入口 + 抽屉面板
 *
 * 挂在 conversation.session.header.actions（list / session 作用域），
 * 组件 props 里能拿到 sessionId —— 所以这个按钮天然是「当前这个会话」的。
 * 与 Host 通过 /dsh-session-memory-api 通信。
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/dsh-session-memory-api'

    const KIND_LABEL = {
      fact: '事实',
      preference: '偏好',
      decision: '决定',
      person: '人物',
    }

    const CARD_FIELDS = [
      ['alias', '别称'],
      ['role', '身份/关系'],
      ['appearance', '外貌'],
      ['personality', '性格'],
      ['background', '背景'],
      ['speech', '口吻'],
      ['notes', '备注'],
    ]

    // ---------------------------------------------------------------- 样式
    const S = {
      btn: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 26,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
        lineHeight: '24px',
        whiteSpace: 'nowrap',
      },
      btnOn: {
        borderColor: 'var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-state-business-primary)',
      },
      mask: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.28)',
        zIndex: 9998,
      },
      drawer: {
        position: 'fixed',
        top: 54,
        right: 16,
        width: 460,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 90px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,.18)',
        zIndex: 9999,
        overflow: 'hidden',
        fontSize: 13,
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flex: '0 0 auto',
      },
      title: { fontWeight: 600, fontSize: 13, flex: 1 },
      body: { padding: '10px 12px', overflowY: 'auto', flex: 1, minHeight: 0 },
      row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
      chip: {
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      input: {
        flex: 1,
        minWidth: 0,
        height: 28,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        outline: 'none',
      },
      textarea: {
        width: '100%',
        minHeight: 56,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        resize: 'vertical',
        outline: 'none',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
      smallBtn: {
        height: 26,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      primary: {
        height: 26,
        padding: '0 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-state-business-primary)',
        background: 'var(--dsw-alias-state-business-primary)',
        color: '#fff',
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      danger: {
        height: 24,
        padding: '0 6px',
        borderRadius: 5,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 11,
        cursor: 'pointer',
      },
      item: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        padding: '6px 8px',
        marginBottom: 6,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        background: 'var(--dsw-alias-bg-base)',
      },
      itemText: { flex: 1, minWidth: 0, lineHeight: 1.5, wordBreak: 'break-word' },
      meta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },
      sectionTitle: {
        fontSize: 12,
        fontWeight: 600,
        margin: '10px 0 6px',
        color: 'var(--dsw-alias-label-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      },
      switch: {
        width: 36,
        height: 20,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .15s',
      },
      knob: {
        position: 'absolute',
        top: 2,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left .15s',
      },
      empty: {
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        padding: '8px 0',
      },
      foot: {
        display: 'flex',
        gap: 6,
        padding: '8px 12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        flex: '0 0 auto',
        flexWrap: 'wrap',
      },
    }

    // ---------------------------------------------------------------- 通信
    async function call(payload) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      if (!text) throw new Error(`HTTP ${res.status} · 响应为空（Host 侧 ${API} 可能没挂载）`)
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`HTTP ${res.status} · 不是 JSON：${text.slice(0, 100)}`)
      }
    }

    function download(filename, content, mime) {
      try {
        const blob = new Blob([content], { type: `${mime};charset=utf-8` })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      } catch (error) {
        alert('导出失败：' + String(error?.message ?? error))
      }
    }

    // ---------------------------------------------------------------- 小组件
    function Toggle({ on, onChange }) {
      return h(
        'button',
        {
          style: Object.assign({}, S.switch, {
            background: on ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2, #ccc)',
          }),
          onClick: () => onChange(!on),
          title: on ? '点击关闭' : '点击开启',
        },
        h('span', { style: Object.assign({}, S.knob, { left: on ? 18 : 2 }) }),
      )
    }

    function Item({ children, onRemove, actions }) {
      return h('div', { style: S.item }, [
        h('div', { key: 'b', style: S.itemText }, children),
        (actions || []).map((a, i) =>
          h('button', { key: `a${i}`, style: S.smallBtn, onClick: a.onClick, title: a.title || a.label }, a.label),
        ),
        onRemove ? h('button', { key: 'r', style: S.danger, onClick: onRemove }, '删') : null,
      ])
    }

    /** 从 PNG 角色卡里取 chara 字段（SillyTavern 酒馆卡就是 PNG 里塞 base64 JSON）。 */
    async function extractPngChara(file) {
      const buf = new Uint8Array(await file.arrayBuffer())
      const sig = [137, 80, 78, 71, 13, 10, 26, 10]
      if (buf.length < 8) return ''
      for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return ''
      const dec = new TextDecoder('utf-8')
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      let off = 8
      while (off + 8 <= buf.length) {
        const len = view.getUint32(off)
        const type = dec.decode(buf.subarray(off + 4, off + 8))
        const start = off + 8
        const end = start + len
        if (end > buf.length) break
        if (type === 'tEXt') {
          const chunk = buf.subarray(start, end)
          const nul = chunk.indexOf(0)
          if (nul > 0 && dec.decode(chunk.subarray(0, nul)) === 'chara') {
            const b64 = dec.decode(chunk.subarray(nul + 1)).trim()
            try {
              const bin = atob(b64)
              const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
              return new TextDecoder('utf-8').decode(bytes)
            } catch {
              return ''
            }
          }
        }
        if (type === 'iTXt') {
          const chunk = buf.subarray(start, end)
          const nul = chunk.indexOf(0)
          if (nul > 0 && dec.decode(chunk.subarray(0, nul)) === 'chara') {
            // keyword \0 flag(1) method(1) lang \0 translated \0 text
            let p = nul + 1 + 2
            let e = chunk.indexOf(0, p)
            if (e < 0) break
            p = e + 1
            e = chunk.indexOf(0, p)
            if (e < 0) break
            p = e + 1
            return dec.decode(chunk.subarray(p))
          }
        }
        if (type === 'IEND') break
        off = end + 4 // 跳过 CRC
      }
      return ''
    }

    // ---------------------------------------------------------------- 抽屉
    function Drawer({ sessionId, onClose }) {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [text, setText] = useState('')
      const [kind, setKind] = useState('fact')
      const [limitDraft, setLimitDraft] = useState('')
      const [cardOpen, setCardOpen] = useState(false)
      const [card, setCard] = useState({ name: '', alias: '', role: '', appearance: '', personality: '', background: '', speech: '', notes: '' })
      const fileRef = useRef(null)
      // 群聊意向：只有真的探测到群聊插件，才显示这一节；探不到就完全不出现
      const [chatOn, setChatOn] = useState(false)
      const [intent, setIntent] = useState(null)

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const res = await fetch('/dsh-session-chat-api?op=state', { method: 'GET' })
            if (!alive) return
            if (!res.ok) {
              setChatOn(false)
              return
            }
            const text = await res.text()
            let parsed = null
            try {
              parsed = JSON.parse(text)
            } catch {
              parsed = null
            }
            if (!alive) return
            setChatOn(!!parsed && parsed.ok !== false)
          } catch {
            if (alive) setChatOn(false)
          }
        })()
        return () => {
          alive = false
        }
      }, [])

      const refresh = useCallback(async () => {
        try {
          const out = await call({ sessionId, action: 'state' })
          if (out?.ok) {
            setState(out.data)
            setError('')
          } else {
            setError(out?.text || '读取失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }, [sessionId])

      useEffect(() => {
        refresh()
      }, [refresh])

      const run = useCallback(
        async (payload) => {
          setBusy(true)
          try {
            const out = await call({ sessionId, ...payload })
            if (out?.ok) {
              if (out.data) setState(out.data)
              setError('')
            } else {
              setError(out?.text || '操作失败')
            }
          } catch (e) {
            setError(String(e?.message ?? e))
          } finally {
            setBusy(false)
          }
        },
        [sessionId],
      )

      const doExport = useCallback(
        async (format) => {
          try {
            const out = await call({ sessionId, action: 'export', format })
            if (!out?.ok) {
              setError(out?.text || '导出失败')
              return
            }
            download(out.data.filename, out.data.content, out.data.mime)
          } catch (e) {
            setError(String(e?.message ?? e))
          }
        },
        [sessionId],
      )

      // ---- 人物卡：单独导出 ----
      const doExportCards = useCallback(
        async (format, cardId) => {
          try {
            const out = await call({ sessionId, action: 'exportCards', format, cardId })
            if (!out?.ok) {
              setError(out?.text || '导出失败')
              return
            }
            download(out.data.filename, out.data.content, out.data.mime)
          } catch (e) {
            setError(String(e?.message ?? e))
          }
        },
        [sessionId],
      )

      // ---- 人物卡：导入（JSON / PNG 酒馆卡 / 纯文本都能吃）----
      const doImportCards = useCallback(
        async (file) => {
          if (!file) return
          setBusy(true)
          try {
            let content = ''
            let kind = 'text'
            if (/\.png$/i.test(file.name) || file.type === 'image/png') {
              kind = 'png'
              content = await extractPngChara(file)
              if (!content) {
                setError('这个 PNG 里没找到人物卡数据（没有 chara 字段），换个文件试试。')
                return
              }
            } else {
              content = await file.text()
            }
            const out = await call({ sessionId, action: 'importCards', content })
            if (out?.ok) {
              if (out.data?.state) setState(out.data.state)
              setError('')
              alert(`${out.text}\n（来源：${kind === 'png' ? 'PNG 酒馆卡' : '文本/JSON'}）`)
            } else {
              setError(out?.text || '导入失败')
            }
          } catch (e) {
            setError('导入失败：' + String(e?.message ?? e))
          } finally {
            setBusy(false)
          }
        },
        [sessionId],
      )

      const entries = state?.entries || []
      const cards = state?.characters || []
      const enabled = state?.enabled !== false

      return h('div', null, [
        h('div', { key: 'mask', style: S.mask, onClick: onClose }),
        h('div', { key: 'panel', style: S.drawer }, [
          // 头部
          h('div', { key: 'head', style: S.head }, [
            h('span', { key: 't', style: S.title }, '本会话记忆'),
            h('span', { key: 'c', style: S.chip }, `${entries.length} 条记忆 / ${cards.length} 张卡`),
            h(Toggle, {
              key: 'sw',
              on: enabled,
              onChange: (next) => run({ action: 'toggle', enabled: next }),
            }),
            h('button', { key: 'x', style: S.smallBtn, onClick: onClose }, '关闭'),
          ]),

          // 主体
          h('div', { key: 'body', style: S.body }, [
            error
              ? h(
                  'div',
                  {
                    key: 'err',
                    style: {
                      fontSize: 12,
                      color: 'var(--dsw-alias-state-error-primary)',
                      marginBottom: 8,
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  error,
                )
              : null,

            !enabled
              ? h(
                  'div',
                  {
                    key: 'off',
                    style: {
                      fontSize: 12,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: 'var(--dsw-alias-bg-base)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      marginBottom: 10,
                    },
                  },
                  '记忆已关闭：不再注入上下文，但数据都还在，随时可以再打开。',
                )
              : null,

            // 角色卡库入口提示（制作台在左侧栏 🎭）
            h(
              'div',
              { key: 'launch', style: Object.assign({}, S.meta, { marginBottom: 10 }) },
              '要做角色卡 / 用卡开新会话，走左侧栏的 🎭。',
            ),

            // 记忆模式：独占 / 共存
            h(
              'div',
              {
                key: 'excl',
                style: {
                  border: '1px solid var(--dsw-alias-border-l1)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 10,
                  background: 'var(--dsw-alias-bg-base)',
                },
              },
              [
                h('div', { key: 't', style: S.sectionTitle }, [
                  h('span', { key: 'l' }, '记忆模式'),
                  h(
                    'span',
                    { key: 'c', style: Object.assign({}, S.chip, { marginLeft: 'auto' }) },
                    state?.exclusiveEffective ? '独占·只听我的' : '共存',
                  ),
                ]),
                h('div', { key: 'r', style: S.row }, [
                  h(Toggle, {
                    key: 'sw',
                    on: state?.exclusiveEffective === true,
                    onChange: (next) => run({ action: 'setExclusive', exclusive: next }),
                  }),
                  h('span', { key: 'x', style: { fontSize: 12 } }, '开启后只保留本会话这一套记忆'),
                ]),
                h(
                  'div',
                  { key: 'h', style: S.meta },
                  '默认关。开启后会把 dsh-mnemon 等其他插件注入的记忆内容压掉，只留本会话这一套。新会话的默认值在「设置 → 通用 → 单会话记忆」里调。',
                ),
              ],
            ),

            // 生效上限
            h('div', { key: 'limit', style: S.row }, [
              h('span', { key: 'l', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '每轮注入上限'),
              h('input', {
                key: 'i',
                style: Object.assign({}, S.input, { flex: '0 0 70px', width: 70 }),
                value: limitDraft === '' ? String(state?.injectLimit ?? 20) : limitDraft,
                onChange: (e) => setLimitDraft(e.target.value.replace(/[^0-9]/g, '')),
                onBlur: () => {
                  if (limitDraft === '') return
                  run({ action: 'setLimit', injectLimit: Number(limitDraft) })
                  setLimitDraft('')
                },
              }),
              h('span', { key: 'u', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '条（置顶的另算）'),
            ]),

            // 群聊回复意向：探测不到群聊插件时整块不渲染
            chatOn
              ? (() => {
                  const serverIntent = Number.isFinite(state?.chatIntent) ? state.chatIntent : null
                  const shown = intent !== null ? intent : serverIntent !== null ? serverIntent : 100
                  return h(
                    'div',
                    {
                      key: 'chatintent',
                      style: {
                        border: '1px solid var(--dsw-alias-border-l1)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        marginBottom: 10,
                        background: 'var(--dsw-alias-bg-base)',
                      },
                    },
                    [
                      h('div', { key: 't', style: S.sectionTitle }, [
                        h('span', { key: 'l' }, '群聊回复意向'),
                        h(
                          'span',
                          { key: 'v', style: Object.assign({}, S.chip, { marginLeft: 'auto' }) },
                          serverIntent === null ? `默认 · ${shown}%` : `${shown}%`,
                        ),
                      ]),
                      h('div', { key: 'r', style: S.row }, [
                        h('input', {
                          key: 'rng',
                          type: 'range',
                          min: 0,
                          max: 100,
                          step: 5,
                          value: shown,
                          style: { flex: 1, accentColor: 'var(--dsw-alias-state-business-primary)' },
                          onChange: (e) => setIntent(Number(e.target.value)),
                          onMouseUp: () => {
                            if (intent === null) return
                            run({ action: 'setChatIntent', chatIntent: intent })
                            setIntent(null)
                          },
                          onTouchEnd: () => {
                            if (intent === null) return
                            run({ action: 'setChatIntent', chatIntent: intent })
                            setIntent(null)
                          },
                        }),
                        h(
                          'button',
                          {
                            key: 'rst',
                            style: S.smallBtn,
                            title: '恢复默认：不再干预，按群聊插件自己的路由走',
                            onClick: () => run({ action: 'setChatIntent', chatIntent: null }),
                          },
                          '默认',
                        ),
                      ]),
                      h(
                        'div',
                        { key: 'h', style: S.meta },
                        '收到群聊消息时按这个意向决定接不接话：低就多听少说，高就正常回应；被 @ 时不受限制。',
                      ),
                    ],
                  )
                })()
              : null,

            // 加一条
            h('div', { key: 'add', style: { marginBottom: 10 } }, [
              h('div', { key: 'r', style: S.row }, [
                h(
                  'select',
                  {
                    key: 'k',
                    style: Object.assign({}, S.input, { flex: '0 0 88px', width: 88 }),
                    value: kind,
                    onChange: (e) => setKind(e.target.value),
                  },
                  ['fact', 'preference', 'decision', 'person'].map((k) =>
                    h('option', { key: k, value: k }, KIND_LABEL[k]),
                  ),
                ),
                h('button', {
                  key: 'b',
                  style: S.primary,
                  disabled: busy || !text.trim(),
                  onClick: () => {
                    const value = text.trim()
                    if (!value) return
                    run({ action: 'addEntry', text: value, kind })
                    setText('')
                  },
                }, '记住这条'),
              ]),
              h('textarea', {
                key: 'ta',
                style: S.textarea,
                placeholder: '手动加一条记忆，比如「主人要求所有回复用中文」',
                value: text,
                onChange: (e) => setText(e.target.value),
              }),
            ]),

            // 记忆列表
            h('div', { key: 'st1', style: S.sectionTitle }, [
              h('span', { key: 'l' }, '记忆条目'),
              entries.length
                ? h('button', {
                    key: 'c',
                    style: Object.assign({}, S.danger, { marginLeft: 'auto' }),
                    onClick: () => {
                      if (confirm(`确定清空这 ${entries.length} 条记忆？人物卡不受影响。`)) run({ action: 'clearEntries' })
                    },
                  }, '清空')
                : null,
            ]),
            entries.length === 0
              ? h('div', { key: 'e1', style: S.empty }, '还没有记忆。让 AI 自己记，或者在上面手动加。')
              : entries.map((item, i) =>
                  h(
                    Item,
                    { key: item.id || i, onRemove: () => run({ action: 'removeEntry', id: item.id }) },
                    [
                      h('div', { key: 'x' }, item.text),
                      h('div', { key: 'm', style: S.meta }, [
                        KIND_LABEL[item.kind] || '事实',
                        item.pinned ? ' · 置顶' : '',
                        ' · ',
                        new Date(item.createdAt).toLocaleString('zh-CN'),
                      ].join('')),
                    ],
                  ),
                ),

            // 人物卡
            h('div', { key: 'st2', style: S.sectionTitle }, [
              h('span', { key: 'l' }, '人物卡'),
              h(
                'button',
                {
                  key: 'a',
                  style: Object.assign({}, S.smallBtn, { marginLeft: 'auto' }),
                  onClick: () => setCardOpen((v) => !v),
                },
                cardOpen ? '收起' : '＋ 新建',
              ),
              h(
                'button',
                {
                  key: 'imp',
                  style: S.smallBtn,
                  title: '支持 JSON / PNG 酒馆卡 / 纯文本；字段名对不上的会自动转换',
                  onClick: () => fileRef.current?.click(),
                },
                '导入',
              ),
              cards.length
                ? h('button', { key: 'exm', style: S.smallBtn, title: '导出全部人物卡（Markdown）', onClick: () => doExportCards('md') }, 'MD')
                : null,
              cards.length
                ? h('button', { key: 'exj', style: S.smallBtn, title: '导出全部人物卡（JSON）', onClick: () => doExportCards('json') }, 'JSON')
                : null,
              h('input', {
                key: 'file',
                type: 'file',
                accept: '.json,.txt,.md,.png,application/json,text/plain,image/png',
                style: { display: 'none' },
                ref: fileRef,
                onChange: (e) => {
                  const f = e.target.files && e.target.files[0]
                  e.target.value = ''
                  doImportCards(f)
                },
              }),
            ]),

            cardOpen
              ? h(
                  'div',
                  {
                    key: 'cf',
                    style: {
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 8,
                      padding: 8,
                      marginBottom: 8,
                      background: 'var(--dsw-alias-bg-base)',
                    },
                  },
                  [
                    h('div', { key: 'n', style: S.row }, [
                      h('input', {
                        key: 'i',
                        style: S.input,
                        placeholder: '姓名（必填）',
                        value: card.name,
                        onChange: (e) => setCard({ ...card, name: e.target.value }),
                      }),
                      h('input', {
                        key: 'a',
                        style: S.input,
                        placeholder: '别称',
                        value: card.alias,
                        onChange: (e) => setCard({ ...card, alias: e.target.value }),
                      }),
                    ]),
                    CARD_FIELDS.filter(([k]) => k !== 'alias').map(([key, label]) =>
                      h('div', { key, style: S.row }, [
                        h(
                          'input',
                          {
                            key: 'i',
                            style: S.input,
                            placeholder: label,
                            value: card[key] || '',
                            onChange: (e) => setCard({ ...card, [key]: e.target.value }),
                          },
                        ),
                      ]),
                    ),
                    h('div', { key: 'b', style: S.row }, [
                      h(
                        'button',
                        {
                          key: 's',
                          style: S.primary,
                          disabled: busy || !card.name.trim(),
                          onClick: () => {
                            if (!card.name.trim()) return
                            run({ action: 'addCard', ...card })
                            setCard({ name: '', alias: '', role: '', appearance: '', personality: '', background: '', speech: '', notes: '' })
                            setCardOpen(false)
                          },
                        },
                        '建立人物卡',
                      ),
                    ]),
                  ],
                )
              : null,

            cards.length === 0
              ? h('div', { key: 'e2', style: S.empty }, '还没有人物卡。可以手动新建，或点上面的「导入」吃一张现成的卡。')
              : cards.map((c, i) =>
                  h(
                    Item,
                    {
                      key: c.id || i,
                      onRemove: () => run({ action: 'removeCard', id: c.id }),
                      actions: [
                        { label: 'MD', title: '只导出这张卡（Markdown）', onClick: () => doExportCards('md', c.id) },
                        { label: 'JSON', title: '只导出这张卡（JSON）', onClick: () => doExportCards('json', c.id) },
                      ],
                    },
                    [
                      h('div', { key: 'n', style: { fontWeight: 600 } }, c.name + (c.alias ? `（${c.alias}）` : '')),
                      c.role ? h('div', { key: 'r', style: S.meta }, c.role) : null,
                      c.personality ? h('div', { key: 'p', style: S.meta }, '性格：' + c.personality) : null,
                      c.speech ? h('div', { key: 's', style: S.meta }, '口吻：' + c.speech) : null,
                      c.appearance ? h('div', { key: 'a', style: S.meta }, '外貌：' + c.appearance) : null,
                      c.background ? h('div', { key: 'b', style: S.meta }, '背景：' + c.background) : null,
                      c.notes ? h('div', { key: 'o', style: S.meta }, '备注：' + c.notes) : null,
                    ],
                  ),
                ),
          ]),

          // 底部：导出
          h('div', { key: 'foot', style: S.foot }, [
            h('span', { key: 'l', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginRight: 'auto' } }, '导出（格式自选）'),
            h('button', { key: 'md', style: S.smallBtn, onClick: () => doExport('md') }, '导出 Markdown'),
            h('button', { key: 'json', style: S.smallBtn, onClick: () => doExport('json') }, '导出 JSON'),
          ]),
        ]),
      ])
    }

    // ---------------------------------------------------------------- 设置页：新会话默认值
    // 挂在 settings.general.item 上，属于「插件/全局设置」，不跟会话绑。
    function SettingsRow() {
      const [settings, setSettings] = useState(null)

      const refresh = useCallback(async () => {
        try {
          const out = await call({ action: 'getSettings' })
          if (out?.ok) setSettings(out.data.settings)
        } catch {
          /* 面板没挂上时不打扰 */
        }
      }, [])

      useEffect(() => {
        refresh()
      }, [refresh])

      const toggle = useCallback(
        async (next) => {
          setSettings((prev) => ({ ...(prev || {}), defaultExclusive: next }))
          try {
            const out = await call({ action: 'setDefaultExclusive', defaultExclusive: next })
            if (out?.ok) setSettings(out.data.settings)
            else refresh()
          } catch {
            refresh()
          }
        },
        [refresh],
      )

      const on = settings?.defaultExclusive === true

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 0',
            borderTop: '1px solid var(--dsw-alias-border-l1)',
          },
        },
        [
          h('div', { key: 'l', style: { flex: 1, minWidth: 0 } }, [
            h('div', { key: 't', style: { fontSize: 13, fontWeight: 500 } }, '单会话记忆'),
            h(
              'div',
              { key: 'd', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
              '新会话默认开启「独占」：只保留单会话记忆这一套，压掉 dsh-mnemon 等其他插件注入的记忆内容。会话里的开关仍可单独改。',
            ),
          ]),
          h(Toggle, { key: 'sw', on, onChange: toggle }),
        ],
      )
    }

    // ---------------------------------------------------------------- 左侧：角色卡开场
    // 侧栏图标 → main 面板。面板第一步就是三选一：已有人物卡 / 导入 / 新建。
    const LAUNCHER_KEY = 'session-memory-launcher'
    const ALL_CARD_FIELDS = [['name', '姓名'], ...CARD_FIELDS]

    // 会话顶部工具栏的 🎭：点开抽屉式角色卡制作台
    // （sidebar.panellist + main 的组合受 layout 初始化时序影响，第三方晚注册会不显示，
    //  所以改用已验证可靠的 conversation.session.header.actions）
    function CardLauncher(props) {
      const sessionId = props?.sessionId
      const [open, setOpen] = useState(false)
      return h('span', { style: { display: 'inline-flex' } }, [
        h(
          'button',
          {
            key: 'b',
            title: '角色卡库：做卡 / 用卡开新会话',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 26,
              padding: '0 8px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 12,
              lineHeight: '24px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
            onClick: () => setOpen(true),
          },
          '🎭',
        ),
        open
          ? h('div', { key: 'wrap' }, [
              h('div', {
                key: 'mask',
                style: {
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,.32)',
                  zIndex: 9998,
                },
                onClick: () => setOpen(false),
              }),
              h(
                'div',
                {
                  key: 'panel',
                  style: {
                    position: 'fixed',
                    top: 48,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 900,
                    maxWidth: 'calc(100vw - 32px)',
                    height: 'min(78vh, 720px)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    color: 'var(--dsw-alias-label-primary)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    borderRadius: 12,
                    boxShadow: '0 18px 48px rgba(0,0,0,.26)',
                    zIndex: 9999,
                    overflow: 'hidden',
                  },
                },
                [
                  h(
                    'div',
                    {
                      key: 'close',
                      style: {
                        position: 'absolute',
                        top: 10,
                        right: 12,
                        zIndex: 2,
                      },
                    },
                    [
                      h(
                        'button',
                        {
                          key: 'x',
                          style: {
                            width: 26,
                            height: 26,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: 6,
                            fontSize: 16,
                            lineHeight: 1,
                            color: 'var(--dsw-alias-label-secondary)',
                          },
                          onClick: () => setOpen(false),
                          title: '关闭',
                        },
                        '×',
                      ),
                    ],
                  ),
                  h('div', { key: 'studio', style: { flex: 1, minHeight: 0 } }, [
                    h(CardStudio, { key: 's', sessionId }),
                  ]),
                ],
              ),
            ])
          : null,
      ])
    }

    const emptyLibraryForm = () => ({
      id: '',
      name: '',
      alias: '',
      role: '',
      appearance: '',
      personality: '',
      background: '',
      speech: '',
      notes: '',
    })

    // 一张可选的角色卡（带 hover）
    function CardRow({ card, onPick }) {
      const [hover, setHover] = useState(false)
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            marginBottom: 8,
            border: `1px solid ${hover ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l1)'}`,
            borderRadius: 10,
            background: 'var(--dsw-alias-bg-base)',
            cursor: 'pointer',
            transition: 'border-color .12s, transform .12s',
            transform: hover ? 'translateY(-1px)' : 'none',
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: onPick,
        },
        [
          h(
            'div',
            {
              key: 'av',
              style: {
                width: 34,
                height: 34,
                flex: '0 0 34px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l1)',
                fontSize: 14,
                fontWeight: 600,
              },
            },
            String(card.name || '?').slice(0, 1),
          ),
          h('div', { key: 'b', style: { flex: 1, minWidth: 0 } }, [
            h('div', { key: 'n', style: { fontWeight: 600, fontSize: 13 } }, card.name + (card.alias ? `（${card.alias}）` : '')),
            card.role
              ? h('div', { key: 'r', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } }, card.role)
              : null,
            card.personality
              ? h('div', { key: 'p', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } }, '性格：' + card.personality)
              : null,
            card.fromSession
              ? h('div', { key: 'f', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } }, '来自会话 ' + card.fromSession)
              : null,
          ]),
          h('span', { key: 'go', style: { fontSize: 12, color: 'var(--dsw-alias-state-business-primary)', whiteSpace: 'nowrap' } }, '开工 →'),
        ],
      )
    }

    // 角色卡制作台：左边卡库、右边表单，所有卡统一存在 ~/.dsh/session-memory/cards.json
    function LibraryItem({ card, active, onPick }) {
      const [hover, setHover] = useState(false)
      return h(
        'div',
        {
          style: {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '8px 10px 8px 12px',
            marginBottom: 3,
            borderRadius: 8,
            cursor: 'pointer',
            background: active
              ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12))'
              : hover
                ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))'
                : 'transparent',
            transition: 'background .12s',
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: onPick,
        },
        [
          active
            ? h('span', {
                key: 'bar',
                style: {
                  position: 'absolute',
                  left: 2,
                  top: 8,
                  bottom: 8,
                  width: 3,
                  borderRadius: 2,
                  background: 'var(--dsw-alias-state-business-primary)',
                },
              })
            : null,
          h(
            'span',
            {
              key: 'av',
              style: {
                width: 28,
                height: 28,
                flex: '0 0 28px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--dsw-alias-bg-base)',
                border: '1px solid var(--dsw-alias-border-l1)',
                fontSize: 12,
                fontWeight: 600,
              },
            },
            String(card.name || '?').slice(0, 1),
          ),
          h('div', { key: 'n', style: { flex: 1, minWidth: 0 } }, [
            h(
              'div',
              {
                key: 'a',
                style: {
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              card.name,
            ),
            card.role
              ? h(
                  'div',
                  {
                    key: 'r',
                    style: {
                      fontSize: 11,
                      color: 'var(--dsw-alias-label-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 1,
                    },
                  },
                  card.role,
                )
              : null,
          ]),
        ],
      )
    }

    function CardStudio({ sessionId } = {}) {
      const [library, setLibrary] = useState([])
      const [selectedId, setSelectedId] = useState(null)
      const [form, setForm] = useState(emptyLibraryForm())
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [toast, setToast] = useState('')
      const [created, setCreated] = useState(null)
      const [meta, setMeta] = useState({ version: '', file: '' })
      const [cwd, setCwd] = useState('')
      const [cwdOptions, setCwdOptions] = useState([])
      const [kick, setKick] = useState(false)
      const fileRef = useRef(null)

      const refresh = useCallback(async () => {
        try {
          const out = await call({ action: 'listLibrary' })
          if (out?.ok) {
            setLibrary(out.data.cards || [])
            setMeta({ version: out.data.version || '?', file: out.data.file || '' })
          } else {
            setError(out?.text || '读取卡库失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }, [])

      useEffect(() => {
        refresh()
      }, [refresh])

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const out = await call({ action: 'suggestCwd' })
            if (!alive || !out?.ok) return
            const list = out.data.cwds || []
            setCwdOptions(list)
            setCwd((prev) => prev || list[0] || '')
          } catch {
            /* 取不到就让用户自己填 */
          }
        })()
        return () => {
          alive = false
        }
      }, [])

      const pick = (card) => {
        setSelectedId(card.id)
        setForm({ ...emptyLibraryForm(), ...card })
        setError('')
        setCreated(null)
      }

      const newCard = () => {
        setSelectedId(null)
        setForm(emptyLibraryForm())
        setError('')
        setCreated(null)
      }

      const save = async () => {
        if (!String(form.name || '').trim()) {
          setError('姓名不能为空')
          return
        }
        setBusy(true)
        try {
          const out = await call({ action: 'saveLibraryCard', card: form })
          if (out?.ok) {
            setLibrary(out.data.cards || [])
            if (out.data.card?.id) setSelectedId(out.data.card.id)
            setToast(out.text || '已保存')
            setError('')
          } else {
            setError(out?.text || '保存失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const remove = async () => {
        if (!selectedId) return
        if (!confirm(`删除「${form.name}」？会从卡库里彻底移除。`)) return
        setBusy(true)
        try {
          const out = await call({ action: 'deleteLibraryCard', id: selectedId })
          if (out?.ok) {
            setLibrary(out.data.cards || [])
            newCard()
            setToast(out.text || '已删除')
          } else {
            setError(out?.text || '删除失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const doImport = async (file) => {
        if (!file) return
        setBusy(true)
        setError('')
        try {
          let content = ''
          if (/\.png$/i.test(file.name) || file.type === 'image/png') {
            content = await extractPngChara(file)
            if (!content) {
              setError('这个 PNG 里没有角色卡数据（没有 chara 字段）。')
              return
            }
          } else {
            content = await file.text()
          }
          const out = await call({ action: 'importLibrary', content })
          if (out?.ok) {
            setLibrary(out.data.cards || [])
            setToast(out.text || '导入完成')
          } else {
            setError(out?.text || '导入失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const startSession = async () => {
        if (!String(form.name || '').trim()) {
          setError('先给这张卡起个名字')
          return
        }
        setBusy(true)
        setError('')
        try {
          const payload = selectedId
            ? { action: 'createSessionWithCard', cardId: selectedId, cwd }
            : { action: 'createSessionWithCard', card: form, cwd }
          const out = await call(payload)
          if (out?.ok) {
            setCreated(out.data)
            if (!selectedId) refresh()
          } else {
            setError(out?.text || '创建失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      // 把卡挂到「当前这个会话」——导入后直接生效，不新建会话
      const applyCurrent = async () => {
        if (!sessionId) {
          setError('拿不到当前会话 id，只能用「开新会话」')
          return
        }
        if (!String(form.name || '').trim()) {
          setError('先给这张卡起个名字')
          return
        }
        setBusy(true)
        setError('')
        try {
          const payload = selectedId
            ? { sessionId, action: 'applyCardToSession', cardId: selectedId, kick }
            : { sessionId, action: 'applyCardToSession', card: form, kick }
          const out = await call(payload)
          if (out?.ok) {
            setToast(out.text || '已挂到当前会话')
            setCreated(null)
            if (!selectedId) refresh()
          } else {
            setError(out?.text || '挂载失败')
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const label = (text) =>
        h('div', { key: 'l', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 3 } }, text)

      const field = (key, text, multiline) =>
        h('div', { key, style: { marginBottom: 9, flex: 1, minWidth: 0 } }, [
          label(text),
          multiline
            ? h('textarea', {
                key: 'i',
                style: Object.assign({}, S.textarea, { minHeight: 54, boxSizing: 'border-box' }),
                value: form[key] || '',
                onChange: (e) => setForm({ ...form, [key]: e.target.value }),
              })
            : h('input', {
                key: 'i',
                style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }),
                value: form[key] || '',
                onChange: (e) => setForm({ ...form, [key]: e.target.value }),
              }),
        ])

      const groupTitle = (text) =>
        h(
          'div',
          {
            key: 'g' + text,
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--dsw-alias-label-secondary)',
              letterSpacing: '.04em',
              margin: '4px 0 8px',
              paddingBottom: 5,
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
            },
          },
          text,
        )

      const banner = (kind, text) =>
        h(
          'div',
          {
            key: 'b' + kind,
            style: {
              margin: '0 16px 8px',
              padding: '7px 10px',
              borderRadius: 7,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              border: '1px solid ' + (kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)'),
              color: kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
              background: 'var(--dsw-alias-bg-base)',
            },
          },
          text,
        )

      return h(
        'div',
        {
          style: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
            minHeight: 0,
          },
        },
        [
          // 顶栏
          h(
            'div',
            {
              key: 'head',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
                flex: '0 0 auto',
              },
            },
            [
              h(
                'div',
                {
                  key: 'icon',
                  style: {
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 17,
                    background: 'var(--dsw-alias-bg-base)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                  },
                },
                '🎭',
              ),
              h('div', { key: 't', style: { flex: 1, minWidth: 0 } }, [
                h('div', { key: 'a', style: { fontSize: 14, fontWeight: 600 } }, '角色卡库'),
                h(
                  'div',
                  { key: 'b', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
                  `共 ${library.length} 张 · 插件 v${meta.version || '?'}`,
                ),
              ]),
              h('button', { key: 'n', style: S.smallBtn, onClick: newCard }, '＋ 新建'),
              h(
                'button',
                { key: 'imp', style: S.primary, disabled: busy, onClick: () => fileRef.current?.click() },
                busy ? '处理中…' : '导入',
              ),
              h('input', {
                key: 'f',
                type: 'file',
                accept: '.json,.txt,.md,.png,application/json,text/plain,image/png',
                style: { display: 'none' },
                ref: fileRef,
                onChange: (e) => {
                  const f = e.target.files && e.target.files[0]
                  e.target.value = ''
                  doImport(f)
                },
              }),
            ],
          ),

          error ? banner('error', error) : null,
          toast ? banner('toast', toast) : null,
          created
            ? banner('ok', `✅ 已创建会话「${created.cardName}」（${created.sessionId}）—— 去左侧会话列表点开它，人设已挂好。`)
            : null,

          // 主体
          h('div', { key: 'body', style: { flex: 1, display: 'flex', minHeight: 0 } }, [
            h(
              'div',
              {
                key: 'side',
                style: {
                  width: 236,
                  flex: '0 0 236px',
                  borderRight: '1px solid var(--dsw-alias-border-l1)',
                  overflowY: 'auto',
                  padding: '8px 6px',
                  background: 'var(--dsw-alias-bg-layer-1)',
                },
              },
              library.length === 0
                ? h(
                    'div',
                    { key: 'e', style: Object.assign({}, S.empty, { padding: '18px 10px', textAlign: 'center' }) },
                    '卡库还是空的。点右上「导入」吃一张现成的，或「＋ 新建」写一张。',
                  )
                : library.map((card) =>
                    h(LibraryItem, {
                      key: card.id,
                      card,
                      active: card.id === selectedId,
                      onPick: () => pick(card),
                    }),
                  ),
            ),
            h('div', { key: 'main', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } }, [
              h('div', { key: 'scroll', style: { flex: 1, overflowY: 'auto', padding: '14px 18px' } }, [
                // 工作区
                h('div', { key: 'cwdrow', style: { marginBottom: 12 } }, [
                  label('新会话工作区'),
                  h('input', {
                    key: 'i',
                    style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }),
                    value: cwd,
                    list: 'sm-cwd-options',
                    placeholder: '留空则用当前开着的会话的工作区',
                    onChange: (e) => setCwd(e.target.value),
                  }),
                  h('datalist', { key: 'dl', id: 'sm-cwd-options' }, cwdOptions.map((c, i) => h('option', { key: i, value: c }))),
                ]),

                groupTitle('基本信息'),
                h('div', { key: 'r1', style: { display: 'flex', gap: 10 } }, [
                  field('name', '姓名（必填）'),
                  field('alias', '别称'),
                ]),
                field('role', '身份 / 关系'),

                groupTitle('人设'),
                field('appearance', '外貌', true),
                field('personality', '性格', true),
                field('background', '背景', true),

                groupTitle('表达'),
                field('speech', '口吻 / 说话方式', true),
                field('notes', '备注', true),
              ]),

              // 底部动作栏（固定在面板底部，不随表单滚）
              h(
                'div',
                {
                  key: 'actions',
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 18px',
                    borderTop: '1px solid var(--dsw-alias-border-l1)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    flex: '0 0 auto',
                    flexWrap: 'wrap',
                  },
                },
                [
                  h('button', { key: 's', style: S.smallBtn, disabled: busy, onClick: save }, selectedId ? '保存修改' : '存进卡库'),
                  h(
                    'button',
                    { key: 'apply', style: S.primary, disabled: busy, onClick: applyCurrent },
                    sessionId ? '挂到当前会话' : '挂到当前会话（无会话）',
                  ),
                  h(
                    'label',
                    {
                      key: 'kick',
                      title: '勾上则挂载后由角色先说一句开场白',
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 12,
                        cursor: 'pointer',
                        color: 'var(--dsw-alias-label-secondary)',
                      },
                    },
                    [
                      h('input', {
                        key: 'c',
                        type: 'checkbox',
                        checked: kick,
                        onChange: (e) => setKick(e.target.checked),
                      }),
                      '挂上后让角色先说话',
                    ],
                  ),
                  selectedId
                    ? h(
                        'button',
                        {
                          key: 'd',
                          style: Object.assign({}, S.danger, { height: 26, padding: '0 10px', marginLeft: 'auto' }),
                          disabled: busy,
                          onClick: remove,
                        },
                        '删除这张卡',
                      )
                    : null,
                ],
              ),
            ]),
          ]),
        ],
      )
    }

    // ---------------------------------------------------------------- 工具栏按钮
    function MemoryButton(props) {
      const sessionId = props?.sessionId
      const [open, setOpen] = useState(false)
      const [badge, setBadge] = useState(null)
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const refreshBadge = useCallback(async () => {
        if (!sessionId) return
        try {
          const out = await call({ sessionId, action: 'state' })
          if (!mounted.current) return
          if (out?.ok) {
            setBadge({
              entries: out.data.entries.length,
              characters: out.data.characters.length,
              enabled: out.data.enabled !== false,
            })
          }
        } catch {
          /* 面板没挂载时不打扰，点开才报错 */
        }
      }, [sessionId])

      useEffect(() => {
        refreshBadge()
      }, [refreshBadge])

      // 抽屉开着时定期刷新，让 AI 自己记的东西也能及时出现在面板里
      useEffect(() => {
        if (!open) return undefined
        const timer = setInterval(refreshBadge, 4000)
        return () => clearInterval(timer)
      }, [open, refreshBadge])

      if (!sessionId) return null

      const total = (badge?.entries || 0) + (badge?.characters || 0)
      const dim = badge && badge.enabled === false

      return h('span', { style: { display: 'inline-flex' } }, [
        h(
          'button',
          {
            key: 'b',
            style: Object.assign({}, S.btn, dim ? {} : S.btnOn, dim ? { opacity: 0.55 } : {}),
            title: '本会话记忆：点开开关 / 增删 / 导出',
            onClick: () => setOpen((v) => !v),
          },
          [`🧠 ${total}`, dim ? '（关）' : ''].join(''),
        ),
        open ? h(Drawer, { key: 'd', sessionId, onClose: () => { setOpen(false); refreshBadge() } }) : null,
      ])
    }

    // ---------------------------------------------------------------- 注册
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'session-memory',
              order: 40,
            },
            MemoryButton,
          ),
        )
        // 全局设置项：新会话默认是否独占（不跟会话绑）
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'session-memory-defaults',
              order: 60,
            },
            SettingsRow,
          ),
        )
        // 角色卡库只留输入框内部左侧这一个入口（顶部工具栏那个已删）
        // 不用 composer.dock —— 它要求 variant === "composer"，新会话页（hero）不满足，不会显示。
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'session-memory-cards-input',
              order: 50,
            },
            CardLauncher,
          ),
        )
      },
    }
  },
})
