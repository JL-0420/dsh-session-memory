# 单会话记忆（dsh-session-memory）

让**每个会话各记各的**：事实、偏好、决定，加上结构化的人物卡。本地落盘，互不可见。

> 这个插件只管「当前这个会话自己」的小本子，换会话就换本子。

## 装法

设置 → 插件 → 添加插件：

```
https://github.com/JL-0420/dsh-session-memory
```

## 配套群聊功能（非必须）

```
https://github.com/JL-0420/dsh-session-chat-final
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
├──────────────────────────────────────────────┤
│ 导出（格式自选）  [导出 Markdown] [导出 JSON]  │
└──────────────────────────────────────────────┘
```

- 开关关掉：立刻停止注入，**数据不删**
- 条数可以调；置顶的条目永远注入，不占普通配额
- 抽屉开着时每 4 秒自动刷新一次，AI 自己记进去的东西会及时出现

## AI 自己也能记

两个工具，都只作用于**调用它的那个会话**：

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

## 角色卡库（左侧栏制作台）

左侧栏有一个 `🎭` 图标，点它进入**角色卡制作台**（`main` 面板）。所有卡**统一存在一个卡库**里，不再分散到各会话。

```
┌───────────────────────────────────────────────────────────┐
│ 🎭 角色卡库          共 3 张 · cards.json   [＋新建] [导入] │
├──────────────┬────────────────────────────────────────────┤
│ (爱) 爱莉希雅 │ 姓名 [爱莉希雅    ] 别称 [粉色妖精小姐    ]  │
│ (阿) 阿岚     │ 身份 / 关系 [逐火之蛾成员               ]   │
│ (老) 老陈     │ 外貌 [粉色长卷发，精灵耳…               ]   │
│              │ 性格 [开怀、爱笑、黏人…                  ]   │
│              │ 背景 [……                                ]   │
│              │ 口吻 [语气轻快，句尾带「～」…            ]   │
│              │ 备注 [……                                ]   │
│              │                                            │
│              │ [保存修改] [用这张卡开新会话]     [删除这张卡]│
└──────────────┴────────────────────────────────────────────┘
```

### 卡库是全局的

| | |
|---|---|
| 位置 | `~/.dsh/session-memory/cards.json` |
| 行为 | 导入 / 新建的卡**全部进这个库**，可改名、可改字段、可删除 |
| 同名 | 再存一次走**更新**，不会堆重复卡 |
| 删除 | 表单右下角「删除这张卡」，从库里彻底移除 |

### 四个动作

| 动作 | 做什么 |
|---|---|
| `＋ 新建` | 清空表单，填完点「存进卡库」 |
| `导入` | 选 JSON / PNG 酒馆卡 / 纯文本 → 自动解析转换 → 批量入库 |
| `保存修改` | 选中一张卡改完，存回库里 |
| `用这张卡开新会话` | 建会话 + 把这卡挂上去 |


### 建完之后会发生什么

1. `ctx.agents.create()` 建出新会话，**会话名直接用角色卡的姓名**
2. 这张卡写进新会话的 `sessions/<新id>.json`，标为置顶
3. 再加一条**置顶记忆**：`本会话的角色是「xxx」，请以这个角色的人设和口吻来回应。`
4. 顶部出现绿色提示条，写着新会话 id

### 新会话挂哪个工作区

⚠️ 这块踩过坑：卡片库是全局面板，**拿不到「当前会话」**，所以不能拿 `process.cwd()` 兜底——那会把会话挂进 DSH 的 profile 目录。

现在的取值顺序：

1. 表单里「新会话工作区」填的（可手填，也可从下拉选当前开着会话用过的目录）
2. 还活着的会话的工作区（`sessions.get(id).header.cwd`）
3. 最后才退到进程 cwd

### 会话名怎么做上去的

```js
const session = ctx.get('sessions').get(newId)
ctx.get('sessionTitle').rename(session, card.name)
// 拿不到 title 服务时退化为：
session.append('session/title', { title: card.name, messageSeqs: [], source: { kind: 'user' } })
```

设不上不影响建会话，只会提示「会话名没设上，可手动改名」。

### 三个限制

| 限制 | 说明 |
|---|---|
| **不会自动跳过去** | 创建在 Host 侧，界面跳转归客户端；建好后去左侧会话列表点开它 |
| **工作区要自己确认** | 表单里有「新会话工作区」，默认跟当前开着的会话走，建之前看一眼 |
| **失败会回滚** | `agents.create` 是事务式的，建不出来就报错，不留半截会话 |

> 如果连会话都没建成，会明确告诉你「宿主没有 agents.create」或具体错误，不会假装成功。

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
  "entries":    [ { "id": "...", "text": "...", "kind": "fact", "tags": [], "pinned": false, "createdAt": 0 } ],
  "characters": [ { "id": "...", "name": "...", "alias": "", "role": "", "appearance": "", "personality": "", "background": "", "speech": "", "notes": "", "createdAt": 0 } ]
}
```

`exclusive` 三态：`null` 跟随全局默认 / `true` 独占 / `false` 共存。

- 首次写入自动建目录
- 超量自动裁剪：`maxEntries`(500) / `maxCharacters`(100)，保留最近的
- 重装插件**不会丢数据**；`stateDir` 可在 config 里改

## 导出

分两种，别混：

### ① 整份记忆（底部按钮）

| 按钮 | 产物 | 适合 |
|---|---|---|
| 导出 Markdown | `.md`，分「记忆条目」「人物卡」两节 | 人看、丢给别的 AI |
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
`addCard` / `updateCard` / `removeCard` / `export` / `exportCards` / `importCards` / `diag`。

- `exportCards`：`{ format: 'md'|'json', cardId? }`，不传 `cardId` 就是全部
- `importCards`：`{ content: '文件原文' }`，服务端自动识别 JSON / 文本并做字段转换

> 挂载注意：`webServer` 在 `apply` 阶段常常还没就绪，必须用 `ctx.inject(['webServer'], …)` 等它出现，
> 直接 `ctx.get('webServer')` 会静默拿到 undefined，面板就永远空响应。这点和 session-chat 一致。

## 边界

- **只搬文本**，不读不写任何会话工作区文件。
- 按 `sessionId` 分文件，**A 会话的记忆永远不会出现在 B 会话的上下文里**。
- 关掉开关只是停止注入，数据保留。
- 和 `dsh-mnemon`、`dsh-session-chat-final` 不冲突：mnemon 走它自己的 Source，本插件走独立的
  `systemPrompt.context` 名字（`session-memory`），UI 挂在 `list` 类型的槽位上，多个插件可以并存。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 工具栏没有 `🧠` 按钮 | 插件没加载，或 client.js 没重启；看设置→插件里是否启用 |
| 按钮有但点开报「响应为空」 | Host 路由没挂上，重启 DSH；或看日志里的 `[session-memory]` 行 |
| AI 记了但面板没变 | 抽屉每 4 秒刷新一次，等一下；或关掉重开 |
| 记忆没进上下文 | 检查开关是否关着、条目是否为空、`injectLimit` 是否为 0 |
| 改了代码没生效 | **卸载重装 + 重启 DSH** |
