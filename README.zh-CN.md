# ClipEverything

把任意网页剪藏成干净的 Markdown 笔记 —— 用**真实浏览器**渲染，而不是简单的 HTTP 抓取。

项目派生自 [obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)，输出对 Obsidian 友好：YAML frontmatter + `# H1` 标题 + 正文，表格、代码块、脚注、图片都会保留。

English: [README.md](./README.md)

## 为什么要用真实浏览器

`fetch` + readability 对静态博客有效，其他场景基本失效。ClipEverything 用 Playwright 驱动 Chromium，所以能处理：

- 前端渲染页面（SPA、无限滚动、懒加载图片）
- 需要登录的内容 —— Cookie 会跨次保存
- 必须等 JS 水合完成才出正文的站点（知乎、X/Twitter）
- 屏蔽无头 HTTP 客户端的站点

渲染后的 DOM 交给 [Defuddle](https://github.com/kepano/defuddle) 抽正文，再交给原版 obsidian-clipper 转换器转 Markdown。

## 环境要求

- Node.js 18+
- 一个 Chromium 内核浏览器：**Chrome 或 Edge 会自动检测**，绝大多数机器什么都不用装。
- 只有两者都没有时才需要 `npm run install-browser` 下载 Chromium。
- 只有用 `--video` 时才需要 `npm run setup:video`（yt-dlp + ffmpeg + whisper.cpp + 模型，约 600 MB）。

## 安装

不装也能用，直接 `npx`：

```bash
npx clip-everything "https://example.com/article"
```

或者全局安装：

```bash
npm install -g clip-everything
clip-everything "https://example.com/article"
```

从源码跑：

```bash
git clone git@github.com:bot-naeem/clip-everything.git
cd clip-everything
npm install
npm run clip -- "https://example.com/article"
```

## 快速开始

```bash
npm run clip -- "https://example.com/article"
```

默认输出到 `./clips`，文件名用页面标题。成功时输出 JSON：

```json
{
  "ok": true,
  "url": "https://example.com/article",
  "title": "Example",
  "outputPath": "C:\\work\\clips\\Example.md",
  "contentLength": 4821,
  "converterUsed": "obsidian-converter",
  "extractor": "defuddle",
  "browser": "msedge",
  "warnings": [],
  "elapsedMs": 3920
}
```

失败时向 **stderr** 输出 `ok: false` 的 JSON，带 `stage`（`start` / `navigate` / `extract` / `transform` / `write`），退出码 `1`。警告只走 stderr，stdout 永远是干净的 JSON，方便被脚本/Agent 调用。

## 命令行

```
npm run clip -- <url> [参数]
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--output <dir>`, `-o` | `./clips` | 输出目录 |
| `--filename <pattern>` | `{title}` | 文件名模板，见下方 token |
| `--profile <name>` | `default` | 浏览器 profile 名（保留 Cookie/登录态） |
| `--profile-dir <dir>` | `~/.clip-everything/profiles/<name>` | 直接指定 profile 目录 |
| `--no-persist` | 关闭 | 一次性上下文，不保存 Cookie |
| `--wait <mode>` | `networkidle` | `load` \| `domcontentloaded` \| `networkidle` |
| `--timeout-ms <n>` | `30000` | 导航超时（毫秒） |
| `--browser <name>` | `auto` | `auto` \| `chromium` \| `chrome` \| `msedge` |
| `--headed` | 关闭 | 显示浏览器窗口 |
| `--no-frontmatter` | 关闭 | 不输出 YAML 头 |
| `--video <url>` | 关闭 | 转写视频而不是剪藏网页（见下文） |
| `--help`, `--version` | | |

文件名 token：`{title}` `{domain}` `{date}` `{time}`（本地时间，`YYYY-MM-DD`）。

```bash
# 剪到 Obsidian 仓库，文件名带日期
npm run clip -- "https://zhuanlan.zhihu.com/p/123" -o ~/vault/inbox --filename "{date}-{title}"

# 需要登录的站点：先用可见窗口登录一次，之后复用 Cookie
npm run clip -- "https://x.com/user/status/123" --headed

# 永远等不到 networkidle 的页面
npm run clip -- "https://example.com" --wait domcontentloaded --timeout-ms 60000
```

## 工作原理

```
url
 └─ playwright-core
     ├─ 启动 Chrome/Edge/Chromium（持久化 profile 保留登录态）
     ├─ goto(url)，按 --wait 策略；networkidle 超时自动降级为 domcontentloaded
     ├─ waitForFunction(ready 启发式)   ← 按站点定制，有预算上限，失败不致命
     ├─ evaluate: 注入 Defuddle，跑站点适配器或通用抽取
     └─ evaluate: Defuddle 失败时退化为纯 DOM 抽取
 └─ markdown
     ├─ obsidian-clipper 转换器（src/utils/markdown-converter.ts，经 ts-node）
     └─ Turndown + GFM 兜底
 └─ 写 {filename}.md，绝不覆盖已有文件（自动加 " 1"、" 2" …）
```

Defuddle 的 bundle 通过 CDP `Runtime.evaluate` 注入，不受页面 CSP 限制，也不占用命令行参数——所以 Windows 上同样可用（旧版就是死在 32k 命令行上限上的）。

## 站点适配器

`scripts/lib/sites.js` 里是覆盖通用抽取逻辑的小处理器：

| 适配器 | 处理 |
| --- | --- |
| `zhihu-answer` | `zhihu.com/question/*` —— 渲染后的回答正文，并等待水合 |
| `zhihu-zhuanlan` | `zhuanlan.zhihu.com/p/*` —— 取 `[itemprop=articleBody]`，清除专栏/页脚噪音 |
| `x-status` | `x.com|twitter.com/*/status/*` —— 为兜底抽取器定位推文节点 |

其余站点走 Defuddle，失败再走纯 DOM。新增站点只需加一个 `{ id, match, ready?, extract? }` 对象，不用改主流程。

## 需要登录的页面

Profile 存在 `~/.clip-everything/profiles/<name>`。第一次用 `login` 命令登录一次——它会弹出一个可见的浏览器窗口，关掉窗口时保存会话：

```bash
npm run login -- --profile zhihu            # 打开 https://www.zhihu.com
npm run login -- --profile x --url https://x.com
```

之后复用这个 profile：

```bash
npm run clip -- "https://zhuanlan.zhihu.com/p/123" --profile zhihu
npm run clip -- "https://x.com/user/status/123" --profile x
```

一次性匿名剪藏用 `--no-persist`。

`login` 还会把 `cookies.txt` 导出到 profile 目录。视频流程用的就是它 —— yt-dlp 没法在浏览器运行时读取 Chromium 的 Cookie 库，但 `cookies.txt` 随时可用：

```bash
npm run login -- --profile youtube --url https://www.youtube.com
npm run clip -- --video "https://www.youtube.com/watch?v=..." --profile youtube
```

如果站点返回验证码/登录墙，CLI 会以 `site returned a wall instead of content` 中止并提示先登录，不会写出一个内容错误的笔记。

## 视频转写

`--video` 把讲座、课程、访谈转成带时间戳的 Markdown 笔记。它完全不碰浏览器：yt-dlp 负责拿字幕，没有字幕就下载音频交给 whisper.cpp 转写。

```bash
npm run setup:video                                   # 一次性安装，约 600 MB
npm run clip -- --video "https://www.youtube.com/watch?v=..."
npm run clip -- --video "https://www.youtube.com/watch?v=..." --login   # 登录一次后直接转写
npm run clip -- --video "https://www.bilibili.com/video/BV..." --lang zh --save-srt
```

产出的笔记：

```markdown
---
title: "How great leaders inspire action"
source: "https://www.youtube.com/watch?v=qp0HIF3SfI4"
author: "TED"
site: "YouTube"
published: "2010-05-04"
duration: "17:47"
language: "en"
transcript: "auto captions (en)"
---
# How great leaders inspire action

> TED · 17:47 · auto captions (en)
> https://www.youtube.com/watch?v=qp0HIF3SfI4

## Chapters

- [00:00] Intro

## Transcript

**[00:00]** how do you explain when things don't go as we assume...
```

取字幕的顺序：

1. 人工字幕（按 `--lang` 顺序匹配）
2. 自动字幕
3. 语音转写（`--whisper-model`，默认 `small`）

**GPU 与大模型（可选）。** whisper.cpp 的官方 Windows 包只有 CPU 版。有 N 卡时用 `--whisper-backend faster` 走 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)，可以直接上 `large-v3`，速度还快一个数量级：

```bash
python -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
set CLIP_PYTHON=C:\path\to\python.exe             # python 不在 PATH 时才需要
set CLIP_FASTER_WHISPER_MODEL=D:\models\large-v3  # 模型目录，或 HF 仓库名
npm run clip -- --video "<url>"
```

`--whisper-backend auto`（默认）只要检测到 `CLIP_FASTER_WHISPER_MODEL` 就切到 GPU，否则继续用 whisper.cpp。`CLIP_FASTER_WHISPER_DEVICE`（`cuda`/`cpu`）和 `CLIP_FASTER_WHISPER_COMPUTE`（`float16`/`float32`/`int8_float16`）可微调；Pascal 架构（GTX 10 系）不支持高效 float16，桥接脚本会自动退回 `float32`。

CUDA 运行库由 `nvidia-*-cu12` wheel 提供时会自动加载。

不想每次都设环境变量，就写进 `~/.clip-everything/config.json`：

```json
{
  "whisper": {
    "backend": "faster",
    "python": "C:\\Python311\\python.exe",
    "model": "D:\\models\\large-v3",
    "device": "cuda",
    "compute": "float32"
  }
}
```

优先级：命令行参数 > 环境变量 > 这个文件。

国内下载模型不必翻墙：

```bash
# ModelScope，逐个文件下
curl -L -o model.bin "https://www.modelscope.cn/api/v1/models/pengzhendong/faster-whisper-large-v3-turbo/repo?Revision=master&FilePath=model.bin"
```

实测（i7-7700 + GTX 1080 Ti，40:43 课程音频）：whisper.cpp `small` 用 810 秒，faster-whisper `large-v3-turbo` 用 150 秒，约 16 倍实时。

推荐默认值：GPU 上跑 `large-v3-turbo`。我们实测它在中文术语上比 `large-v3` 更准（CER 3.94% vs 5.39%），还快 3 倍。只有音频嘈杂、多人抢话时才值得切到 `large-v3`。

**整门课程。** 加 `--playlist` 会把课程播放列表逐讲转写，每讲一份笔记，并在同目录生成 `00-Index.md`。单讲失败只会记进索引，不会中断整批：

```bash
npm run clip -- --video "https://www.youtube.com/playlist?list=..." --playlist --profile youtube
npm run clip -- --video "https://www.youtube.com/playlist?list=..." --playlist --limit 3
npm run clip -- --video "https://www.youtube.com/playlist?list=..." --playlist --jobs 3
```

`--jobs` 控制同时转写几讲（GPU 后端默认 2，whisper.cpp 默认 1）。无论谁先跑完，输出和索引都按播放列表顺序排列。

YouTube 的滚动式自动字幕（每条都重复上一条）会先去重，再按超过 2.5 秒的停顿合并成段落，所以读起来是文章而不是一行一句。`--save-srt` 会把清洗后的字幕同时写成 `.srt`。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--lang <codes>` | `zh-Hans,zh-CN,zh,en` | 字幕语言优先级 |
| `--whisper-model <name>` | `small` | `tiny` \| `base` \| `small` \| `medium` \| `large-v3` |
| `--whisper-backend <name>` | `auto` | `auto` \| `cpp`（whisper.cpp）\| `faster`（GPU） |
| `--whisper-timeout-ms <n>` | max(1 小时, 8 倍音频) | 语音转写时间上限 |
| `--no-whisper` | 关闭 | 没有字幕时直接失败，不转写 |
| `--force-whisper` | 关闭 | 忽略字幕，强制转写音频 |
| `--save-srt` | 关闭 | 额外写出 `<文件名>.srt` |
| `--keep-audio` | 关闭 | 保留下载的音频 |
| `--proxy <url>` / `--no-proxy` | 自动探测本地代理 | yt-dlp 的代理 |
| `--cookies-from-browser <name>` | 关闭 | 复用浏览器登录态（`edge`、`chrome`、`firefox`） |
| `--cookies <file>` | 关闭 | Netscape 格式 `cookies.txt` |
| `--profile <name>` | 关闭 | 使用 `npm run login -- --profile <name>` 导出的 `cookies.txt` |
| `--login` | 关闭 | 打开浏览器登录当前站点，登完继续转写 |
| `--playlist` | 关闭 | 把播放列表里的每个视频都转写 |
| `--limit <n>` | 全部 | 配合 `--playlist`，只转前 `n` 个 |
| `--jobs <n>` | GPU 2 / CPU 1 | 配合 `--playlist`，同时转写几讲 |
| `--threads <n>` | CPU 核数 - 1 | whisper.cpp 线程数 |
| `--timeout-ms <n>` | `600000` | 网络步骤超时（下载、取元信息） |

三个实际会遇到的问题：

- **YouTube 机器人墙。** 数据中心/代理 IP 的匿名请求经常被要求登录（`Sign in to confirm you're not a bot`）。最省事的是加 `--login`：`npm run clip -- --video "<url>" --login`，窗口里登好、关掉，程序自动保存到 `~/.clip-everything/profiles/youtube/cookies.txt` 并继续。以后直接用 `--profile youtube` 复用。
- **别再指望直接读浏览器 Cookie。** Edge/Chrome 127+ 用 app-bound key 加密 Cookie，`--cookies-from-browser edge` 会报 `Failed to decrypt with DPAPI`；浏览器开着时数据库还会被锁。请用 `--login`，或用扩展导出的 `cookies.txt` 配合 `--cookies`。
- **JS 运行时。** YouTube 需要 JS 运行时来解 `n` challenge。ClipEverything 会自动把当前 Node 可执行文件传给 yt-dlp；可用 `CLIP_JS_RUNTIME=deno` 覆盖，或 `CLIP_JS_RUNTIME=none` 关闭。
- **速度。** `small` 模型在 CPU 上大约是 1/5–1/2 倍速；`medium` 更准但慢约 3 倍。有字幕时是秒级。

## 开发

```bash
npm test           # vitest：tests/（CLI 工具库）
npm run test:watch
```

| 路径 | 作用 |
| --- | --- |
| `scripts/clip.js` | CLI 入口：流程编排 + JSON 输出 |
| `scripts/transcribe.js` | `--video` 流程：探测 → 字幕或 Whisper → Markdown |
| `scripts/lib/` | args、browser、extract、sites、markdown、naming、frontmatter |
| `scripts/lib/media/` | yt-dlp / ffmpeg / whisper 封装 + 字幕解析 |
| `tests/` | CLI 工具库单元测试 |
| `src/utils/` | 从 obsidian-clipper 搬来的转换器（3 个文件）：`markdown-converter.ts`、`string-utils.ts`、`debug.ts` |

## 从 1.x（OpenClaw）迁移

1.x 是 shell 调 `openclaw browser`，那个依赖已经彻底移除：

| 1.x | 2.x |
| --- | --- |
| `--profile openclaw` | `--profile <名字>`（浏览器 profile，默认 `default`） |
| 必须先跑 openclaw CLI | 只需要一个浏览器 |
| `openclaw browser … --json` | Playwright API |
| `npm run clip -- <url> --profile openclaw` | `npm run clip -- <url>` |

同时修掉：`defuddle` 和 `ts-node` 现在是正式依赖（以前干净 `npm ci` 会直接跑不起来）；隔离转换器不再通过 argv 传 HTML（Windows 32k 上限）。

## 常见问题

**Windows PowerShell 报 `npm : 无法加载文件 …npm.ps1，因为在此系统上禁止运行脚本`**

PowerShell 默认执行策略挡住了 npm 的 `.ps1` 包装。改用 `.cmd`：

```powershell
npm.cmd run clip -- "https://example.com"
```

或者一次性放开本机脚本（只影响当前用户，不需要管理员）：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**`site returned a wall instead of content`**

页面在登录墙/验证码后面。先用 `npm run login -- --profile <名字>` 登录一次，再用同一个 `--profile` 剪。

**视频：`Sign in to confirm you're not a bot`**

YouTube 对很多代理/机房 IP 会拦匿名请求。直接加 `--login`：

```bash
npm run clip -- --video "<url>" --login
```

窗口里登录、关掉，转写会自动继续。以后用 `--profile youtube` 复用。

**视频：`Requested format is not available`**

yt-dlp 没能解开 YouTube 的 JS challenge。ClipEverything 会自动把当前 Node 传给 yt-dlp；如果仍然报错，确认 `node --version` 是 20+，或手动设 `CLIP_JS_RUNTIME=node:C:\path\to\node.exe`。`CLIP_JS_RUNTIME=none` 可关闭该参数。

**视频：`Failed to decrypt with DPAPI`**

Edge/Chrome 127+ 用 app-bound key 加密 Cookie，yt-dlp 读不了。改用 `--login`，或用浏览器扩展导出 `cookies.txt` 后传 `--cookies <文件>`。

**剪藏先等约 30 秒，然后警告 `networkidle never settled`**

有些页面保持长连接。加 `--wait domcontentloaded`。

## License

MIT
