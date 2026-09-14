# 聊天记录查看器（fast-ytx-chatlog-viewer）

基于 **Electron + React + TypeScript** 的 Windows 桌面应用，用于解析并展示某聊天软件
SQLite 数据库中的聊天记录。应用**只读**打开源库，解码后建立本地索引缓存，面向
十万级消息提供流畅的浏览与多维检索体验。

---

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 数据自动发现 | 启动时自动扫描「程序所在目录」等候选路径下的 `*.db`，校验含 `message_list` / `chat_list` 表后才加载；多库时约定文件名优先、其次取修改时间最新，可在界面中切换 |
| 会话列表 | 单聊 / 群聊 / 置顶分组，名称搜索、最后消息摘要与时间、消息条数统计，虚拟滚动 |
| 消息时间线 | 按时间升序浏览，自动日期分隔，虚拟滚动 + 动态测高；向上滚动无限加载更早历史并保持滚动位置 |
| 多类型消息渲染 | 文本、图片、文件、@提醒、引用回复、表情、群系统消息、已撤回消息差异化展示；内网图片 / 文件以占位卡片优雅降级，可尝试加载或打开原始链接 |
| 全局搜索 | 跨全部会话检索，按会话聚合分组、命中计数与耗时展示、关键字高亮，点击结果直达消息上下文 |
| 会话内搜索 | 当前会话内查找、命中计数与上一条 / 下一条跳转定位 |
| 多维筛选 | 发送人（多选）、消息类型（多选）、日期范围（快捷区间 + 自定义）组合过滤，实时生效 |
| 主题与布局 | 明暗主题切换、三栏自适应布局、无边框自定义标题栏、玻璃拟态视觉与微交互 |
| 索引管理 | 展示发现的数据源、索引构建进度、缓存占用，支持重建与重新扫描 |

---

## 数据源与编码说明

### 源库结构

样例库（`message3763.db`，约 94 MB，78,614 条消息 / 211 个会话）包含三张表：

- `chat_list`：会话列表（`id` / `name` / `avatar` / `type` / `lastMessage` / `seq` …）
- `message_list`：消息主表（`id` / `name` / `chatId` / `fromId` / `type` / `at` /
  `content` / `timestamp` / `mine` / `withDraw` / `strDate` / `messageType` …）
- `chat_top`：置顶会话

### content 编码规则

`content` 存在两种形态，实践中均需处理：

1. **明文**，如 `好的`
2. **字节数组编码**，如 `encode229,165,189,231,154,132`
   → 去掉 `encode` 前缀，按逗号拆分为十进制字节，按 **UTF-8** 解码 → `好的`

此外大量字段存放字面量 `undefined` / `null` 脏值，读取时统一归一化为空。

### messageType 归一化

| 原始值 | 归一化类型 | 说明 |
| --- | --- | --- |
| `0` / `5` | `text` | 纯文本 |
| `1` | `file` | 文件消息，content 为 `<a class="file-wrapper">` 富文本 |
| `2` | `image` | 图片消息，content 为 `<img class="chat-img">` |
| `3` | `emoji` | 表情 / 富文本（非 HTML 时按 `text` 兜底） |
| `4` | `at` | @提醒（非 HTML 时按 `text` 兜底） |
| `6` | `quote` | 引用回复（`chat-quote`） |
| `8` | `system` | 群系统消息（入群 / 退群等） |
| `withDraw='true'` | `withdrawn` | 已撤回 |
| `null` / `'undefined'` / 其他 | 结构启发式判定，兜底 `text` | 历史消息 |

---

## 技术架构

```
渲染进程 (React + Tailwind + zustand + @tanstack/react-virtual)
        │  window.api（contextBridge 白名单）
预加载 (preload, contextIsolation + sandbox)
        │  IPC（通道常量 + 入参校验）
主进程
  ├─ 数据源发现（程序目录 / resources / userData）
  ├─ 源库只读连接（better-sqlite3，readonly）
  ├─ 内容解码器（encode → UTF-8、脏值归一化、HTML → 纯文本）
  └─ 索引缓存（userData/index-cache，流式构建 + 明文与分面索引）
```

### 为何使用索引缓存

源库 `content` 为字节编码，SQL 层无法直接做明文匹配，且每条记录都需要解码。
因此首次加载时**流式扫描**只读源库，将解码后的明文与分面字段写入 `userData`
下的缓存库（按「源文件路径 + 大小 + 修改时间」哈希命名），后续启动直接复用；
源库指纹变化时自动重建，界面所有查询都走缓存，兼顾准确性与查询性能。

**不写入源库**：源库始终以 `readonly: true` 打开。

### 性能与内存策略

- 分页使用 **keyset 游标**（`timestamp + row_id` 复合条件），避免大偏移 `OFFSET` 性能坍塌
- 渲染层全程**虚拟滚动**，DOM 节点数量恒定，内存不随数据量线性膨胀
- 索引构建**分批提交并让出事件循环**，主进程可持续回传进度且不卡死界面
- 缓存连接限制 `cache_size`，消息内容按需解码，原始内容仅在有富文本时下发
- 实测：索引首次构建约 **3.5 秒**（78,614 条），时间线单页查询约 **10–25 ms**，
  全局检索约 **50–110 ms**（关键字命中规模 12 ~ 2,962 条）

---

## 开发与构建

### 环境要求

- Node.js 20+（开发机实测 Node 24）
- npm 10+
- Windows 10/11（打包目标平台）

### 安装依赖

本项目使用原生模块 `better-sqlite3`，需针对 **Electron 的 ABI** 构建，而系统 Node 版本
通常没有对应预编译包。项目内 `.npmrc` 已设置 `ignore-scripts=true`，因此：

```bash
npm install     # 只拉取依赖，不执行安装脚本
npm run setup   # 下载 Electron 运行时 + 安装 better-sqlite3 的 Electron 预编译二进制
```

> 若网络受限，可先设置镜像：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`
> 再执行 `npm run setup`。

### 开发运行

```bash
npm run dev        # 开发模式（热更新）
npm run typecheck  # TypeScript 全量类型检查
npm run build      # 构建到 out/
```

开发模式下「程序目录」即为项目根目录，因此把 `*.db` 放在项目根目录即可被自动发现。

### 打包 Windows 产物

```bash
npm run build:win
```

产物输出到 `release/`：

- `ChatLogViewer-1.0.0-x64-setup.exe` —— NSIS 安装包（可选安装目录、创建桌面与开始菜单快捷方式）
- `ChatLogViewer-1.0.0-x64-portable.exe` —— 免安装绿色版

---

## 数据放置约定

打包后应用按以下顺序扫描候选目录（去重）：

1. **exe 所在目录**（绿色版可直接把 `*.db` 放在旁边）
2. `resources` 目录及其上级目录
3. `%APPDATA%/<应用名>`（userData）

约定文件名指形如 `message.db`、`message3763.db` 的文件，优先级高于其他命名（例如带
日期后缀的备份库 `message3763-2026-09-10-09-57-57.db`），随后按修改时间取最新。

> 安装版安装在 `Program Files` 时该目录只读，此时请把数据库放到 `userData` 目录，
> 或使用绿色版并放在程序同级目录。

---

## 目录结构

```
src/
├── shared/                  # 主/渲染进程共享
│   ├── types.ts             # 类型契约（ChatItem / MessageItem / MessageQuery …）
│   ├── ipc-channels.ts      # IPC 通道常量
│   └── content.ts           # 内容解码、脏值归一化、富文本结构化解析
├── main/                    # 主进程
│   ├── index.ts             # 入口、窗口、生命周期
│   ├── db/discovery.ts      # 数据源发现与校验
│   ├── index-cache/
│   │   ├── cache-key.ts     # 缓存键与失效判定
│   │   ├── builder.ts       # 流式构建缓存
│   │   ├── repository.ts    # 分页 / 检索 / 分面查询
│   │   └── service.ts       # 索引服务与进度回传
│   └── ipc/handlers.ts      # IPC 处理器（入参校验）
├── preload/index.ts         # contextBridge 白名单 API
└── renderer/                # 渲染进程
    ├── index.html
    └── src/
        ├── App.tsx
        ├── components/      # layout / chat / message / search / filter / settings
        ├── store/           # zustand 状态切片
        ├── hooks/
        └── lib/             # IPC 封装、格式化、高亮
```

---

## 安全说明

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 渲染层仅能通过 `contextBridge` 暴露的白名单通道访问能力
- 主进程对全部 IPC 入参做类型与范围校验（字符串长度、枚举白名单、数组上限、日期格式）
- 渲染层**不使用** `dangerouslySetInnerHTML`，富文本一律解析为结构化数据后由 React 组件渲染
- 通过 CSP 限制资源来源；外链一律交由系统浏览器打开，禁止窗口内导航与新窗口
- 源数据库**零写入**：均为只读连接；缓存写入仅发生在 `userData/index-cache`

---

## 许可

本项目仅用于本地聊天记录查看与检索，请确保在合法合规的前提下使用。
