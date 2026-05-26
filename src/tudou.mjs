#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "tudou.config.json");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const config = await readConfig();

  if (command === "prepare") {
    await prepareAssets(config, args);
    return;
  }

  if (command === "build") {
    await buildOutputs(config);
    return;
  }

  if (command === "gallery") {
    await buildOutputs(config);
    console.log(`图库已生成：${path.join(ROOT, "index.html")}`);
    return;
  }

  if (command === "publish-help") {
    printPublishHelp(config);
    return;
  }

  printHelp();
}

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function resolveProjectPath(value) {
  return path.resolve(ROOT, value);
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function getArg(args, name, fallback) {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

async function prepareAssets(config, args) {
  const source = expandHome(getArg(args, "from", "~/Desktop/merge-game-images"));
  const sourceDir = path.resolve(source);
  const imageDir = resolveProjectPath(config.paths.images);
  const videoDir = resolveProjectPath(config.paths.videos);

  await fs.mkdir(imageDir, { recursive: true });
  await fs.mkdir(videoDir, { recursive: true });

  const files = await listFiles(sourceDir);
  let imageCount = 0;
  let videoCount = 0;
  let skipped = 0;

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = sanitizeFileName(path.basename(filePath));

    if (IMAGE_EXTS.has(ext)) {
      await fs.copyFile(filePath, path.join(imageDir, fileName));
      imageCount += 1;
    } else if (VIDEO_EXTS.has(ext)) {
      await fs.copyFile(filePath, path.join(videoDir, fileName));
      videoCount += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`整理完成：${imageCount} 张图片，${videoCount} 个视频，跳过 ${skipped} 个文件。`);
  await buildOutputs(config);
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(fileName);
  const base = parsed.name
    .normalize("NFC")
    .replace(/[\r\n\t]/g, "_")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "asset"}${parsed.ext.toLowerCase()}`;
}

async function buildOutputs(config) {
  const outputDir = resolveProjectPath(config.paths.output);
  await fs.mkdir(outputDir, { recursive: true });

  const assets = [
    ...await collectAssets(config, "images"),
    ...await collectAssets(config, "videos"),
  ];

  const mapping = {};
  for (const asset of assets) {
    mapping[asset.path] = asset.urls.jsdelivr;
  }

  await fs.writeFile(
    path.join(outputDir, "mapping.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), assets, mapping }, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(path.join(outputDir, "asset-list.md"), renderAssetList(assets), "utf8");
  await fs.writeFile(path.join(ROOT, "index.html"), renderGallery(config, assets), "utf8");

  console.log(`生成完成：${assets.length} 个资源`);
  console.log(`- ${path.join(outputDir, "mapping.json")}`);
  console.log(`- ${path.join(outputDir, "asset-list.md")}`);
  console.log(`- ${path.join(ROOT, "index.html")}`);
}

async function collectAssets(config, kind) {
  const dir = resolveProjectPath(config.paths[kind]);
  await fs.mkdir(dir, { recursive: true });
  const files = await listFiles(dir);

  const assets = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (kind === "images" && !IMAGE_EXTS.has(ext)) continue;
    if (kind === "videos" && !VIDEO_EXTS.has(ext)) continue;

    const relativePath = toPosix(path.relative(ROOT, filePath));
    const publicPath = toPosix(path.relative(resolveProjectPath("public"), filePath));
    const bytes = (await fs.stat(filePath)).size;

    assets.push({
      type: kind === "images" ? "image" : "video",
      name: path.basename(filePath),
      path: relativePath,
      publicPath,
      bytes,
      sha256: await sha256(filePath),
      urls: makeUrls(config, relativePath),
    });
  }

  return assets.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function makeUrls(config, relativePath) {
  const owner = process.env.GITHUB_OWNER || config.github.owner;
  const repo = process.env.GITHUB_REPO || config.github.repo;
  const branch = process.env.GITHUB_BRANCH || config.github.branch;
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const rawPath = relativePath.split("/").map((part) => encodeURIComponent(part).replace(/%20/g, "%20")).join("/");

  return {
    jsdelivr: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${encodedPath}`,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rawPath}`,
    github: `https://github.com/${owner}/${repo}/blob/${branch}/${encodedPath}`,
  };
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAssetList(assets) {
  const rows = assets.map((asset) => (
    `| ${asset.type} | \`${asset.path}\` | ${formatBytes(asset.bytes)} | ${asset.urls.jsdelivr} |`
  )).join("\n");

  return `# 图兜资源清单

生成时间：${new Date().toLocaleString("zh-CN")}

| 类型 | 本地路径 | 大小 | jsDelivr URL |
|---|---:|---:|---|
${rows}
`;
}

function renderGallery(config, assets) {
  const owner = process.env.GITHUB_OWNER || config.github.owner;
  const repo = process.env.GITHUB_REPO || config.github.repo;
  const cards = assets.map((asset) => {
    const preview = asset.type === "image"
      ? `<img loading="lazy" src="${asset.path}" alt="${escapeHtml(asset.name)}" class="h-40 w-full rounded-xl object-cover">`
      : `<video src="${asset.path}" class="h-40 w-full rounded-xl object-cover" controls preload="metadata"></video>`;

    return `<article class="asset-card rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-blue-500">
      ${preview}
      <div class="mt-3 min-w-0">
        <h2 class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</h2>
        <p class="mt-1 text-xs text-slate-500">${asset.type} · ${formatBytes(asset.bytes)}</p>
      </div>
      <button class="copy-btn mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:scale-[1.02] hover:bg-blue-600 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-blue-300" data-url="${asset.urls.jsdelivr}">复制 CDN 链接</button>
    </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN" class="scroll-smooth">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>图兜资源库</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = { darkMode: 'class' };
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  </script>
  <style>
    .asset-card { animation: fadeIn .5s ease both; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  </style>
</head>
<body class="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
  <header class="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
    <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-[0.3em] text-blue-500">GitHub Image Bed</p>
        <h1 class="text-xl font-semibold">图兜资源库</h1>
      </div>
      <button id="themeToggle" class="rounded-xl border border-slate-200 px-3 py-2 text-sm transition hover:scale-105 hover:border-blue-300 dark:border-slate-800">切换主题</button>
    </div>
  </header>

  <main class="mx-auto max-w-7xl px-4 py-10">
    <section class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-sm text-slate-500">仓库：${escapeHtml(owner)}/${escapeHtml(repo)}</p>
      <h2 class="mt-2 text-3xl font-semibold tracking-tight">共 ${assets.length} 个资源</h2>
      <p class="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">上传到 GitHub 后，点击复制按钮即可获得稳定的 jsDelivr CDN 链接，用于替换 HTML 中的飞书临时图片地址。</p>
    </section>

    <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      ${cards}
    </section>
  </main>

  <footer class="mx-auto max-w-7xl px-4 pb-10 text-sm text-slate-500">
    由图兜生成 · ${new Date().getFullYear()}
  </footer>

  <script>
    document.getElementById('themeToggle').addEventListener('click', () => {
      const html = document.documentElement;
      html.classList.toggle('dark');
      localStorage.theme = html.classList.contains('dark') ? 'dark' : 'light';
    });

    document.querySelectorAll('.copy-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(button.dataset.url);
        const old = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => button.textContent = old, 1200);
      });
    });
  </script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printPublishHelp(config) {
  const owner = process.env.GITHUB_OWNER || config.github.owner;
  const repo = process.env.GITHUB_REPO || config.github.repo;
  const branch = process.env.GITHUB_BRANCH || config.github.branch;

  console.log(`发布步骤：

1. 在 GitHub 创建公开仓库：${repo}
2. 修改 tudou.config.json：
   github.owner = "${owner === "YOUR_GITHUB_USERNAME" ? "你的 GitHub 用户名" : owner}"
   github.repo = "${repo}"
   github.branch = "${branch}"
3. 执行：
   npm run prepare-assets -- --from ~/Desktop/merge-game-images
   git add .
   git commit -m "Add image bed assets"
   git branch -M ${branch}
   git remote add origin git@github.com:${owner}/${repo}.git
   git push -u origin ${branch}

4. CDN 地址格式：
   https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/public/images/文件名
`);
}

function printHelp() {
  console.log(`图兜 - GitHub 图床整理工具

常用命令：
  npm run prepare-assets -- --from ~/Desktop/merge-game-images
  npm run build
  npm run gallery
  npm run publish-help
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
