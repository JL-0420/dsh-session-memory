# 单会话记忆 + 情绪（dsh-session-memory）

让**每个会话各记各的**：事实、偏好、决定，加上结构化的人物卡，**还有一整套会变的情绪和会长的性格**。本地落盘，互不可见。

> 跟 `dsh-mnemon` 的区别：mnemon 管的是全局热记忆（USER.md / MEMORY.md）和跨会话的 Memory Space；
> 这个插件只管「当前这个会话自己」的小本子，换会话就换本子。

> **v1.0.0 起**：原本独立的 `dsh-session-mood`（情绪/性格）已整套并进本插件。
> 情绪数据存在同一个会话文件里（`sessions/<id>.json` 的 `mood` 字段），
> 旧版 `~/.dsh/session-mood/sessions/<id>.json` 会在第一次读取时**自动迁移**。
> 独立插件从 bundles 摘掉即可，目录不用删。

一个插件里现在有三样东西：

| 模块 | 工具 | 管什么 |
|---|---|---|
| 记忆 | `session_memory` | 事实/偏好/决定 + 艾宾浩斯衰减 + 日记 |
| 情绪 | `session_mood` | 8 维情绪强度 + 性格标签，随对话变化 |
| 人物卡 | `session_card` | 结构化角色设定 + 全局卡库 |

## 装法

设置 → 插件 → 添加插件：

```
C:\Users\17833\Desktop\dsh插件研发\自我配置\dsh-session-memory
```

**改动过代码必须卸载重装，并重启 DSH**（Host 与 Web 端都要重新加载）。

## 用起来长什么样

会话窗口**顶部工具栏**多一个 `🧠 N` 按钮 —— 这个按钮天然属于当前会话（挂在
`conversation.session.header.actions`，`session` 作用域），点开就是抽屉：

```
┌──────────────────────────────────────────────┐
│ 本会话记忆        7 条记忆 / 2 张卡   [●] [关闭] │
├──────────────────────────────────────────────┤
│ 每轮注入上限 [20] 条（置顶的另算）              │
│ ┌──────┬──────────────────────────────┐       │
│ │ 事实 ▾│                        [记住这条]│       │
│ └──────┴──────────────────────────────┘       │
│ ┌────────────────────────────────────┐        │
│ │ 手动加一条记忆…                      │        │
│ └────────────────────────────────────┘        │
│ 记忆条目                              [清空]   │
│ ┌ （偏好）所有回复用中文                  [删] │
│ ┌ （事实）主人主模型是 deepseek-flash      [删] │
│ 人物卡                                [＋新建] │
│ 🧑 阿岚（小岚）· 同伴                  [删]   │
│ ┌ 情绪 / 性格      😐 平静 60  [开关] [展开] ┐ │
│ │ #嘴硬心软 ×  #护短 ×                       │ │
│ │ [加一个性格标签，回车确认]                  │ │
│ │ 😊 开心  ━━━━━●━━━  70                    │ │
│ │ …（8 个情绪滑块）                          │ │
│ │ [让 AI 重新判断]                           │ │
│ └────────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ 导出（格式自选）  [导出 Markdown] [导出 JSON]  │
└──────────────────────────────────────────────┘
```

- 开关关掉：立刻停止注入，**数据不删**
- 条数可以调；置顶的条目永远注入，不占普通配额
- 抽屉开着时每 4 秒自动刷新一次，AI 自己记进去的东西会及时出现
- 情绪/性格默认收起，点「展开」才显示滑块，不占地方

## 情绪与性格

从 v1.0.0 起这块内置，不再需要单独的 `dsh-session-mood`。

### 八维情绪，不是一个状态

每个维度 **0-100**，可以同时成立：

| id | 情绪 | 表情 |
|---|---|---|
| `happy` | 开心 | 😊 |
| `calm` | 平静 | 😐 |
| `down` | 低落 | 😞 |
| `angry` | 生气 | 😠 |
| `shy` | 害羞 | 😳 |
| `excited` | 兴奋 | 🤩 |
| `tired` | 疲惫 | 😪 |
| `sad` | 委屈 | 🥺 |

所以「开心 70 + 兴奋 55 + 平静 20」这种混合状态是正常的。默认 `平静 60`，其他 0。

### 性格是长出来的，不是选出来的

没有预设选项。性格由两部分组成：

1. **一句自定义补充**（手填，可留空）
2. **AI 自己贴的标签** —— 对话里它发现自己确实有某种倾向，就用
   `session_mood` 的 `personality + addTag` 贴一个，会一直累积（最多 20 个）

注入里长这样：

```
性格不是预设好的，是你自己在对话里长出来的：
发现自己确实有某种倾向（嘴硬心软、护短、爱记仇、怕麻烦…），
用 session_mood 的 personality + addTag 贴上去，之后按这些标签行事。
```

### 新会话不预置情绪

新会话第一轮**不给任何情绪数值**，只给一条提示：

```
【当前情绪 · 还没定】
这个会话你还没有情绪状态。先读完这轮对话，然后给自己定一个初始心情：
· 想想刚才看到的内容让你有什么感觉，挑 1-3 个情绪
· 用 session_mood 的 set（或 emotions 对象一次给多个）写进去，0-100
· 不确定就按角色性格猜一个合理的，不要留空
```

AI 在第一轮回复过程中 `set` 一次，`needsJudge` 转 false，之后按正常流程注入。

面板上的「让 AI 重新判断」会把情绪清空 + `needsJudge = true`，下一轮重新定一次（不是简单清成平静 60）。

### 情绪也会随对话变

注入里带检查清单：

```
【情绪检查 · 每轮过一遍】
回复前判断：这一轮对话让你的情绪有波动吗？
· 被夸 / 被逗 / 被冷落 / 被催 / 话题变沉重… → 用 session_mood 的 adjust 调 1-2 个情绪（±10~30 就够）
· 平平淡淡 → 不动，别硬凑。
情绪是会变的，长时间停在同一个值才是异常的。
```

最后一句是刻意写的——明确告诉它「不变才不正常」，否则它会一直停在 `平静 60`。

### `session_mood`（工具）

| action | 作用 |
|---|---|
| `get` | 看当前性格标签 + 八个情绪 |
| `set` | `{ emotion, value }` 或 `{ emotions: { happy: 70 } }` 直接设 |
| `adjust` | `{ emotion, delta }` 在现值上加减（更像情绪起伏） |
| `personality` | `{ text?, addTag?, removeTag? }` 改性格 / 贴标签 |
| `history` | `{ limit? }` 看变化记录 |

每次真的变了才写一条 `history`（带 `by: ai/user` 和原因）。

## AI 自己也能记

**三个工具**（`session_memory` / `session_mood` / `session_card`），都只作用于**调用它的那个会话**：

### `session_memory`

| action | 作用 |
|---|---|
| `add` | 记一条（`text` + 可选 `kind` / `tags` / `pinned`） |
| `list` | 看已记住的，可按 `query` 过滤 |
| `update` / `remove` | 按 `id` 改 / 删 |
| `clear` | 清空记忆（人物卡保留） |
| `status` | 看开关、条数、数据文件路径 |

`kind` 取值：`fact` 事实 / `preference` 偏好 / `decision` 决定 / `person` 人物相关。

### `session_card`（人物卡）

| action | 作用 |
|---|---|
| `add` | 建卡：`name` 必填，另有 `alias` / `role` / `appearance` / `personality` / `background` / `speech` / `notes` |
| `list` / `get` | 列表 / 单张全文 |
| `update` / `remove` | 按 `id` 或 `name` 改 / 删 |

人物卡是**结构化人设**，跟自由文本记忆互补，两者都会进上下文。

### 人物卡导入 / 单独导出（面板）

人物卡不是只能手打——**从现成的卡导入**，或者**单独把卡导出去**。

面板「人物卡」这一行的按钮：

| 按钮 | 作用 |
|---|---|
| `＋ 新建` | 展开手填表单 |
| `导入` | 选文件导入，格式不对**自动转换** |
| `MD` / `JSON` | 导出**本会话全部**人物卡 |
| 每张卡上的 `MD` / `JSON` | **只导出这一张** |
| 每张卡上的 `删` | 删除该卡 |

#### 导入支持哪些格式

| 来源 | 说明 |
|---|---|
| **SillyTavern / 酒馆卡 v2、v3** | `{ spec: 'chara_card_v2', data: {…} }`，JSON 直接吃 |
| **PNG 角色卡** | 酒馆卡常见的 PNG，自动从 `tEXt`/`iTXt` 的 `chara` 字段里挖出 base64 JSON（中文不会乱码） |
| **本插件导出的 JSON** | `{ kind: 'character-cards', characters: […] }`，可往返 |
| **裸对象 / 数组** | 单张 `{ name: … }`，或多张 `[{…}, {…}]` |
| **纯文本 / Markdown** | 按「姓名：xxx」「外貌：xxx」这样的键值行解析，遇到「姓名」开新卡 |

#### 字段自动转换规则

导入时所有键名都会**转小写比对**，中英文、大小写、下划线都能命中：

| 目标字段 | 认得的键名（部分） |
|---|---|
| `name` | name / 姓名 / 名字 / char_name / character_name |
| `alias` | alias / nickname / 别称 / 昵称 / 小名 |
| `role` | role / 身份 / 关系 / 职业 / occupation / title |
| `appearance` | appearance / 外貌 / 长相 / 外形 / looks |
| `personality` | personality / 性格 / 性情 / 个性 / traits |
| `background` | background / 背景 / 经历 / 生平 / backstory / bio |
| `speech` | speech / 口吻 / 说话方式 / 口癖 / mes_example / example_dialogue |
| `notes` | notes / 备注 / 说明 / creator_notes / scenario / first_mes / tags |

`description`（酒馆卡那一大段人设）单独处理：按 **外貌 → 背景 → 备注** 的顺序找第一个空位落下，不会被 `creator_notes` 挤掉。

#### 合并规则

- **同名卡 → 更新**（只覆盖有值的字段，不整张替换）
- **异名卡 → 新增**
- 一次最多 200 张，单字段超长自动截断
- 认不出任何卡时**明确报错**，不静默吞掉

## 角色卡库（输入框左侧 · 抽屉）

**输入框内部左侧**有一个 `🎭` 按钮，点开就是角色卡制作台抽屉。所有卡**统一存在一个卡库**里。

```
┌───────────────────────────────────────────────────────────┐
│ 🎭 角色卡库        共 3 张 · 插件 v0.17.0   [＋新建] [导入] │
├──────────────┬────────────────────────────────────────────┤
│ (爱) 爱莉希雅 │ 新会话工作区 [____________________]         │
│ (阿) 阿岚     │ ── 基本信息 ──                              │
│ (老) 老陈     │ 姓名 [爱莉希雅  ] 别称 [粉色妖精小姐]       │
│              │ 身份 / 关系 [逐火之蛾成员]                  │
│              │ ── 人设 ──                                  │
│              │ 外貌 / 性格 / 背景 …                        │
│              │ ── 表达 ──                                  │
│              │ 口吻 / 备注 …                               │
│              ├────────────────────────────────────────────┤
│              │ [保存修改] [挂到当前会话] ☐让角色先说话  [删] │
└──────────────┴────────────────────────────────────────────┘
```

> 入口位置说明：`sidebar.panellist` + `main` 的组合在这版 DSH 里不显示（layout 初始化时会把晚注册的 main key 清掉），
> `conversation.composer.dock` 又要求 `variant === "composer"`（新会话页不满足），所以最终挂在
> `conversation.input.left` —— 条件最宽松、一定会渲染。

### 卡库是全局的

| | |
|---|---|
| 位置 | `~/.dsh/session-memory/cards.json` |
| 行为 | 导入 / 新建 / 挂载的卡**全部进这个库**，可改名、可改字段、可删除 |
| 同名 | 再存一次走**更新**，不会堆重复卡 |
| 删除 | 动作栏右侧「删除这张卡」，从库里彻底移除 |

### 三个动作

| 动作 | 做什么 |
|---|---|
| `保存修改` / `存进卡库` | 选中卡改完存回库里；新卡直接入库 |
| `挂到当前会话` | **把这张卡挂到当前对话**，同时自动入库 |
| `删除这张卡` | 从卡库彻底移除 |

> 「开新会话」按钮已经删掉了。底层 `createSessionWithCard` API 还在，但界面上没有入口。

### 挂到当前会话会发生什么

1. 这张卡**先写进全局卡库**（所以不用再单独点保存）
2. 写进当前会话的 `characters`，同名卡走更新，不重复
3. 加一条**置顶记忆**：`本会话的角色是「xxx」，请以这个角色的人设和口吻来回应。`（重复挂载不会写第二条）
4. 如果勾了「让角色先说话」，会往会话里投递一条开场提示，让角色主动开口：

```
【角色扮演】从现在起你是「爱莉希雅」，用这个角色的身份、语气和性格来回应接下来的对话。
先自然地说一句开场白。
```

**这个勾默认是关的**——不勾就只挂设定、不说话，你想让它开口时再勾。

### 底层仍保留的建会话能力

`createSessionWithCard` API 还能用（会话名 = 角色卡姓名，工作区可指定），只是 UI 入口拿掉了：

1. `ctx.agents.create()` 建出新会话
2. `ctx.get('sessionTitle').rename(session, card.name)` 把会话名设成卡名
3. 卡写进新会话并标置顶

工作区取值顺序：显式 `cwd` → 还活着的会话的 cwd（`sessions.get(id).header.cwd`）→ 进程 cwd。
⚠️ 别用 `process.cwd()` 兜底，那会把会话挂进 DSH 的 profile 目录（踩过）。

## 记忆怎么进上下文

走官方通道，不污染对话正文：

```js
ctx.systemPrompt.context({
  name: 'session-memory',
  order: 850,
  text: (context) => {
    const sessionId = context?.agent?.id   // ← 关键：agent.id 就是会话 id
    ...
  },
})
```

`text` 是函数，每次组装重新求值，所以：**开关一改，下一轮立刻生效**，不用重启。

注入的内容长这样：

```
【本会话记忆】
以下内容属于**当前这个会话**，是它自己攒下来的记录；除与当前用户消息冲突外，默认仍然有效。

- （偏好）所有回复用中文
- （事实）主人主模型是 deepseek-flash

【本会话人物卡】
- 阿岚（小岚）｜同伴
  · 外貌：…
  · 性格：…

（发现值得长期保留的事实、偏好、约定，用 session_memory 的 add 追加；临时进度、一次性路径、猜测不要记。）
```

## 记忆会忘：艾宾浩斯曲线

不是所有记忆都一直占据上下文。每条记忆有**保留率 r**：

```
r = exp(-天数 / 稳定度)      稳定度 = 1 + 复习次数 × 2
```

复习一次，稳定度翻倍，忘得慢一倍。置顶记忆不衰减（r 恒为 1）。

### 三级处理

| 保留率 | 待遇 | 效果 |
|---|---|---|
| **r ≥ 0.6** | 完整注入 | 原文进上下文（最多 300 字） |
| **0.25 ≤ r < 0.6** | **压缩成一行** | 只留前 60 字，标在「快淡忘的记忆」段 |
| **r < 0.25**（或超出配额） | **淡出** | 不进上下文，但保留在库里 + 日记里 |

实际曲线（没复习过）：

| 多久没碰 | 保留率 | 待遇 |
|---|---|---|
| 12 小时 | 0.61 | 完整 |
| 1 天 | 0.37 | 压缩 |
| 3 天 | 0.05 | 淡出 |

### 怎么让记忆活下来

- **自动关联强化**（主力）—— 见下
- **`session_memory` 的 `reinforce { id }`** —— 手动复习一条，稳定度翻倍
- **置顶** —— 永远不衰减

### 自动关联强化：被提到的不会忘

每轮对话开始前（`agent/pre-step`），插件会拿这一轮**用户说的话**去比对记忆：

1. 把每条记忆拆成 **3~4 字的连续片段**
2. 看这一轮用户消息里有没有出现过这些片段
3. 命中 → 这条记忆 `reinforceCount + 1`、`lastUsedAt` 刷新 → **衰减速度立刻减半**
4. **同标签的邻居也跟着回暖**（只刷新时间，不计数）—— 这就是「关联性」

所以：

| 情况 | 结果 |
|---|---|
| 「主人喜欢喝美式咖啡」+ 你说了「今天又喝了美式咖啡」 | 命中 → 计数 +1，回到完整注入 |
| 同标签的「主人讨厌香菜」 | 没被提到，不计数，但跟着刷新时间 |
| 同一 turn 里重复触发 | 只算一次（按 turn 去重） |

效果：**反复被提及的记忆不会淡出，偶尔被连带的邻居也不会被饿死**。

## 日记：原文一条不落

每次 `add` 都会在 `diary` 里留一份**原文副本**：

- **永不删除、永不衰减、永不进上下文**（不花 token）
- 淡出的记忆原文仍然在日记里
- `session_memory` 的 `diary { limit? }` 可以查
- 导出 Markdown 会附上「## 日记（原文，永不删）」章节
- 上限 `maxDiary`(2000)，超了丢最早的

所以：**上下文里看到的是压缩后的精华，日记里留着当初的原话**。

### 自动记：靠的就是最后那句引导

**只给工具不写引导，模型基本不会主动记**——它会一路跑完，一次都不碰 `session_memory`。

所以注入块里固定带一句「什么时候该记、什么时候别记」。空会话也带（换成另一种说法），否则就成死循环：没记忆 → 不提示 → 永远没记忆。

```
【本会话记忆】
（还没有记录。本轮如出现值得长期保留的事实、偏好、约定，可用 session_memory 的 add 记下；
  临时进度和猜测不要记。）
```

想关掉这段：config 里 `autoHint: false`。

### 什么时候不注入

- 开关关掉 → 返回空串
- `autoHint: false` 且没有任何记忆 → 返回空串

## 群聊回复意向（百分制）

抽屉里有一节「群聊回复意向」，**只有当探测到群聊插件（`dsh-session-chat-final`）时才出现**，探不到就整块不渲染。

探测方式：打开抽屉时 `GET /dsh-session-chat-api?op=state`，拿不到 200 + 合法 JSON 就算没有。

| 控件 | 作用 |
|---|---|
| 滑块 | 0 ~ 100，步进 5 |
| 默认 | 清掉设定，恢复「不干预」，按群聊插件自己的路由走 |

设成数字后，注入块里多一段：

```
【群聊回复意向】
当前设为 35%。收到群聊消息时按这个意向决定接不接话：数值低就多听少说、能不接就不接；
数值高就正常回应。被 @ 时不受此限制，@ 一律回应。
```

几个要点：

- **默认是「不干预」**（`chatIntent: null`），不写就不注入，跟没装这个功能一样
- 数值**按会话隔离**，A 会话设 20% 不影响 B 会话
- 它靠上下文引导生效，**不改群聊插件的投递逻辑**——所以不会跟 AI 路由打架
- 被 `@` 时不受意向限制，一律回应

## 独占记忆（开启后只留我这一套）

默认 **关**。开启后本会话只吃自己这一套，别的插件注入的记忆内容会被压掉。

两个地方各管一层，**别混**：

| 位置 | 管什么 | 存哪 |
|---|---|---|
| 会话抽屉 →「记忆模式」开关 | **这一个会话**要不要独占 | 会话文件里的 `exclusive`（`null` = 跟随全局默认） |
| **设置 → 通用 → 单会话记忆** | **新会话默认**要不要独占 | `~/.dsh/session-memory/settings.json` |

> 「新会话默认」故意不放在会话抽屉里——它是插件级设置，跟当前会话没关系。

优先级：**会话显式值 > 全局默认 > 关**。

### 实际压掉的是什么

| 来源 | 形式 | 处理 |
|---|---|---|
| dsh-mnemon 的 `MNEMON RUNTIME MEMORY SNAPSHOT`（含 USER.md / MEMORY.md） | `agent/pre-step` 里追加的一条 user 消息，`source.kind = 'dsh-mnemon'` | 从 `decision.messages` 里剔除 |
| dsh-mnemon 的路由指导 | `systemPrompt.section({ name: 'mnemon:routing' })` | 从 `assembly.sections` 里剔除 |

### 为什么不用官方的 suppressRuntimeContext()

因为它**压不掉这两样**。官方 API 写的是「移除可选动态上下文」，而 mnemon 早就不走 `ctx.systemPrompt.context()` 了：

```js
// dsh-mnemon 的注入方式
source: { kind: 'dsh-mnemon', form: 'recall' }   // 插件消息，不是 context
```

所以只能在 agent 自己的链上动手：**等别的插件算完，再把它们那份剔掉**。拦截挂在 `agent/created` 拿到的 `agent.ctx` 上，天然按会话隔离，随 agent 销毁自动解绑。

### 配置项

想压别的东西，改这两个数组：

```js
blockMessageSources: ['dsh-mnemon', 'plugin:dsh-mnemon'],  // 插件消息的 source.kind
blockSectionNames: ['mnemon:routing'],                      // 提示段的 name
```

> 这两个目前在源码常量里，不是 config 字段；改完重启生效。

### 不干扰别的插件

只是「不把它那段内容递给模型」，mnemon 自己的数据、捕获、可视化都不受影响——关掉独占，一切照旧。

## 数据存放

```
~/.dsh/session-memory/
  sessions/<sessionId>.json    每个会话一份，互不可见
  settings.json                全局设置（新会话默认值）
```

`settings.json`：

```json
{ "defaultExclusive": false }
```

单文件结构：

```json
{
  "version": 1,
  "sessionId": "...",
  "enabled": true,
  "injectLimit": 20,
  "chatIntent": null,
  "exclusive": null,
  "entries":    [ { "id": "...", "text": "...", "kind": "fact", "tags": [], "pinned": false,
                    "reinforceCount": 0, "lastUsedAt": 0, "createdAt": 0 } ],
  "diary":      [ { "id": "...", "text": "原文", "kind": "fact", "tags": [], "at": 0 } ],
  "characters": [ { "id": "...", "name": "...", "alias": "", "role": "", "appearance": "",
                    "personality": "", "background": "", "speech": "", "notes": "", "createdAt": 0 } ],
  "mood": {
    "enabled": true,
    "personality": { "text": "", "tags": ["嘴硬心软"] },
    "emotions": { "happy": 0, "calm": 60, "down": 0, "angry": 0, "shy": 0, "excited": 0, "tired": 0, "sad": 0 },
    "needsJudge": false,
    "history": [ { "at": 0, "by": "ai", "reason": "被夸了",
                   "changes": { "happy": { "from": 0, "to": 70 } } } ]
  }
}
```

`exclusive` 三态：`null` 跟随全局默认 / `true` 独占 / `false` 共存。

`mood.needsJudge`：`true` 表示这个会话还没定过情绪，注入里会给「还没定」提示而不是数值。

- 首次写入自动建目录
- 超量自动裁剪：`maxEntries`(500) / `maxCharacters`(100) / `maxDiary`(2000)，保留最近的
- 重装插件**不会丢数据**；`stateDir` 可在 config 里改
- **从旧版迁移**：如果文件里没有 `mood` 字段，会去 `~/.dsh/session-mood/sessions/<id>.json` 读一次并填进来（只在读时迁移，下次保存后落盘）

## 全局设置（设置 → 通用）

插件在设置页有一张独立卡片 **「单会话记忆」**：

| 项 | 作用 |
|---|---|
| 新会话默认开启「独占」 | 新会话默认压掉 mnemon 等其他插件的记忆注入 |
| 用别的模型辅助判断记忆 | 开/关 + Provider + 模型 + 判断频率 |

### 辅助判断模型

开启后，每轮（或每 N 轮）把你指定的模型叫来当**第二意见**：

```
下面是一段对话。判断其中有没有值得长期记住的信息。
只看：用户明确的偏好 / 习惯 / 禁忌 / 称呼、约定或决定、不会再变的事实、角色设定。
忽略：临时进度、一次性路径、寒暄、猜测。
有就输出 JSON 数组，每项 {"text":"…","kind":"fact|preference|decision|person"}；
没有就只输出 NONE。
```

- **频率可调**：每轮 / 每 2 / 3（默认）/ 5 / 10 轮
- 调的是宿主的 `ctx.get('llm').stream({ provider, model, … })`
- **异步 fire-and-forget**，永远不阻塞对话
- 判断补记的条目带 `judge` 标签
- 允许「先开、后选模型」，没选好时明确提示「暂不生效」而不是把开关弹回去
- 关掉完全不影响原来那套自我记忆逻辑

## 导出

分两种，别混：

### ① 整份记忆（底部按钮）

| 按钮 | 产物 | 适合 |
|---|---|---|
| 导出 Markdown | `.md`，分「记忆条目」「人物卡」「日记」三节 | 人看、丢给别的 AI |
| 导出 JSON | `.json`，带 `plugin` / `version` / `exportedAt` | 备份、程序处理 |

文件名形如 `session-memory-<会话id>-<时间>.md`。

### ② 只导人物卡（人物卡那一行）

| 入口 | 范围 | 格式 |
|---|---|---|
| 人物卡行的 `MD` / `JSON` | 本会话**全部**人物卡 | Markdown / JSON |
| 每张卡上的 `MD` / `JSON` | **只这一张** | Markdown / JSON |

人物卡 JSON 的结构是 `{ plugin, version, kind: 'character-cards', count, characters: […] }`，
**可以直接再导入回来**（同名会走更新，所以往返不会产生重复卡）。

## 面板 API

```
/dsh-session-memory-api    GET  ?action=state&sessionId=...
                           POST { sessionId, action, ... }
```

action：`state` / `toggle` / `setLimit` / `addEntry` / `removeEntry` / `clearEntries` /
`addCard` / `updateCard` / `removeCard` / `export` / `exportCards` / `importCards` / `diag` /
`listLibrary` / `saveLibraryCard` / `deleteLibraryCard` / `importLibrary` / `parseCards` /
`applyCardToSession` / `createSessionWithCard` / `suggestCwd` / `getSettings` / `setDefaultExclusive` /
`setJudge` / `listModels` / **情绪：** `toggleMood` / `setEmotion` / `setPersonality` / `addTag` / `removeTag` / `resetEmotions`。

- `exportCards`：`{ format: 'md'|'json', cardId? }`，不传 `cardId` 就是全部
- `importCards`：`{ content: '文件原文' }`，服务端自动识别 JSON / 文本并做字段转换
- `applyCardToSession`：`{ sessionId, cardId?|card?, kick? }` —— 挂到当前会话；`kick: true` 才让角色开口
- `saveLibraryCard` / `deleteLibraryCard`：卡库增删改（同名走更新）
- `importLibrary`：`{ content }` 批量入库
- `suggestCwd`：返回还活着的会话用过的工作区，给新会话做候选
- `setJudge`：`{ enabled, provider?, model?, everyTurns? }` —— 辅助判断模型；返回 `ready` 表示是否真的生效
- `listModels`：列出宿主可用的 `{ provider, models[] }`
- `setEmotion`：`{ emotion?, value? }` 或 `{ emotions: { happy: 70 } }`
- `toggleMood`：`{ enabled }` —— 只关情绪，记忆不受影响

> 不需要 `sessionId` 的全局 action：`getSettings` / `setDefaultExclusive` / `setJudge` / `listModels` /
> `listLibrary` / `suggestCwd` / `parseCards` / `listAllCards` / `importLibrary` / `saveLibraryCard` /
> `deleteLibraryCard` / `createSessionWithCard`。
> 其余（`state` / `toggle` / `applyCardToSession` / 所有情绪 action）必须带 `sessionId`。

> 挂载注意：`webServer` 在 `apply` 阶段常常还没就绪，必须用 `ctx.inject(['webServer'], …)` 等它出现，
> 直接 `ctx.get('webServer')` 会静默拿到 undefined，面板就永远空响应。这点和 session-chat 一致。

## 边界

- **只搬文本**，不读不写任何会话工作区文件。
- 按 `sessionId` 分文件，**A 会话的记忆和情绪永远不会出现在 B 会话的上下文里**。
- 关掉开关只是停止注入，数据保留。
- **记忆开关和情绪开关是分开的**：关记忆不影响情绪，关情绪也不影响记忆。
- 辅助判断模型是可选的第二意见，关掉不影响原来那套自我记忆逻辑。
- 和 `dsh-mnemon`、`dsh-session-chat-final` 不冲突：mnemon 走它自己的 Source，本插件走独立的
  `systemPrompt.context` 名字（`session-memory`），UI 挂在 `list` 类型的槽位上，多个插件可以并存。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 工具栏没有 `🧠` 按钮 | 插件没加载，或 client.js 没重启；看设置→插件里是否启用 |
| 按钮有但点开报「响应为空」 | Host 路由没挂上，重启 DSH；或看日志里的 `[session-memory]` 行 |
| AI 记了但面板没变 | 抽屉每 4 秒刷新一次，等一下；或关掉重开 |
| 记忆没进上下文 | 检查开关是否关着、条目是否为空、`injectLimit` 是否为 0 |
| 情绪一直不变 | 看注入里有没有「情绪检查」；确认 `mood.enabled` 没关；必要时点「让 AI 重新判断」 |
| 情绪显示「❓ 待判断」 | 正常，说明这个会话还没定过情绪；聊一轮它就该自己定 |
| 设置卡片开关点了没反应 | 看副标题的 `Host vX.Y.Z`；版本不对说明 Host 没重启 |
| 判断模型一直不生效 | 检查是否选了 Provider + 模型；没选好时卡片会提示「暂不生效」 |
| 改了代码没生效 | **卸载重装 + 重启 DSH** |
