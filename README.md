# 图兜

图兜是一个基于 GitHub 仓库和 jsDelivr CDN 的轻量图床工具。它适合把飞书文档中导出的图片整理成稳定链接，再批量替换到 HTML 页面里。

## 它能做什么

- 把本地图片/视频整理到 `public/images` 和 `public/videos`
- 生成 `dist/mapping.json`，用于批量替换 HTML 里的资源链接
- 生成 `dist/asset-list.md`，方便人工检查资源清单
- 生成 `index.html`，作为可浏览、可复制 CDN 链接的图库页

## 快速开始

先把 GitHub 信息改成你的公开仓库：

```json
{
  "github": {
    "owner": "你的 GitHub 用户名",
    "repo": "你的公开仓库名",
    "branch": "main"
  }
}
```

然后导入资源：

```bash
npm run prepare-assets -- --from ~/Desktop/merge-game-images
```

重新生成映射和图库：

```bash
npm run build
```

查看发布步骤：

```bash
npm run publish-help
```

## 推荐 GitHub 仓库设置

- 仓库建议设为 Public
- 图片可以直接使用 jsDelivr：

```text
https://cdn.jsdelivr.net/gh/你的用户名/你的仓库名@main/public/images/001_棋盘空间.jpg
```

- 视频不建议大量放 GitHub，较大的视频更适合 OSS/COS/七牛等对象存储。

## 输出文件

- `public/images/`：图片资源
- `public/videos/`：视频资源
- `dist/mapping.json`：文件名到 CDN URL 的映射
- `dist/asset-list.md`：Markdown 资源清单
- `index.html`：图库页面

## 后续替换网页链接

上传仓库后，把 `dist/mapping.json` 给我，或者告诉我：

```text
GitHub 用户名 / 仓库名 / 分支名
```

我就可以把之前生成的 HTML 里的飞书临时图片地址替换为永久 CDN 地址。
