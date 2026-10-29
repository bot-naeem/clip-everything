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

如果站点返回验证码/登录墙，CLI 会以 `site returned a wall instead of content` 中止并提示先登录，不会写出一个内容错误的笔记。

## 开发

```bash
npm test           # vitest：tests/（CLI 工具库）
npm run test:watch
```

| 路径 | 作用 |
| --- | --- |
| `scripts/clip.js` | CLI 入口：流程编排 + JSON 输出 |
| `scripts/lib/` | args、browser、extract、sites、markdown、naming、frontmatter |
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

**剪藏先等约 30 秒，然后警告 `networkidle never settled`**

有些页面保持长连接。加 `--wait domcontentloaded`。

## License

MIT
