# Obsidian Clipper CLI（中文说明）

基于 `openclaw browser` 的网页剪藏命令行工具，可将网页内容保存为本地 Markdown 文件。

## 功能简介

给定一个 URL，CLI 会按顺序执行：

1. 确保 OpenClaw 浏览器 profile 正在运行。
2. 打开目标网页。
3. 提取正文内容。
4. 转换为 Markdown（复用原始转换链路）。
5. 输出 `.md` 文件到本地目录。

## 环境要求

- Node.js 18+
- npm
- 已安装 OpenClaw CLI，且命令 `openclaw` 可用
- 可用的 OpenClaw 浏览器 profile（默认 `openclaw`）

## 安装步骤（完整）

### 1. 安装 Node.js

先确认本机可用：

```bash
node -v
npm -v
```

如果命令不可用，请先安装 Node.js 18+。

### 2. 安装 OpenClaw CLI

请按 OpenClaw 官方文档安装：

- https://docs.openclaw.ai/cli/browser

安装后验证：

```bash
openclaw --help
```

### 3. 启动 OpenClaw 浏览器 profile

```bash
openclaw browser --browser-profile openclaw start --json
```

检查状态：

```bash
openclaw browser --browser-profile openclaw status --json
```

### 4. 安装项目依赖

```bash
npm ci
```

## 快速开始

```bash
npm run clip -- "https://example.com"
```

默认输出目录为 `./clips`。

如果你想把 Markdown 输出到自定义目录（例如你的 Obsidian 仓库）：

```bash
npm run clip -- "https://example.com" --output "/Users/wmm/obsidian"
```

## 命令用法

```bash
npm run clip -- <url> [options]
```

可选参数：

- `--output <dir>`：输出目录（默认 `clips`）
- `--filename <pattern>`：文件名模板（默认 `{title}`）
- `--profile <name>`：OpenClaw 浏览器 profile（默认 `openclaw`）
- `--wait <load|domcontentloaded|networkidle>`：页面等待模式（默认 `networkidle`）
- `--timeout-ms <n>`：超时时间（毫秒，默认 `30000`）
- `--frontmatter`：启用 YAML frontmatter（默认启用）
- `--no-frontmatter`：禁用 YAML frontmatter

文件名模板变量：

- `{title}`
- `{domain}`
- `{date}`
- `{time}`

示例：

```bash
npm run clip -- "https://zhuanlan.zhihu.com/p/2007944059558323475" \
  --output clips \
  --filename "{date}-{title}" \
  --profile openclaw \
  --timeout-ms 30000
```

## 输出结果

成功时会输出 JSON，例如：

```json
{
  "ok": true,
  "url": "https://example.com",
  "title": "Example",
  "outputPath": "/abs/path/clips/Example.md",
  "contentLength": 1234,
  "converterUsed": "original-createMarkdownContent",
  "elapsedMs": 4567
}
```

## 验收测试

```bash
npm run clip:acceptance
```

知乎专项验收（专栏 + 回答 + 质量规则检测）：

```bash
npm run clip:zhihu-acceptance
```

## 说明

- 当前仓库主路径是稳定的 CLI 剪藏链路。
- 扩展相关构建脚本仍保留在仓库中用于兼容，但不是当前主要使用方式。

## 常见问题排查

若剪藏失败：

1. 确认 OpenClaw 运行状态：
   `openclaw browser --browser-profile openclaw status --json`
2. 重启 OpenClaw 浏览器：
   `openclaw browser --browser-profile openclaw stop --json`
   `openclaw browser --browser-profile openclaw start --json`
3. 提高超时参数，例如：`--timeout-ms 60000`
4. 将等待模式切换为：`--wait domcontentloaded`
