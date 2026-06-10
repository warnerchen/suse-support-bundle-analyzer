[English](README.md) | 简体中文

# SUSE Support Bundle Analyzer

SUSE Support Bundle Analyzer 是一个面向技术支持场景的本地 Web 工具，用于快速分析 SUSE 产品的 support bundle，查看结构化分析结果和原始证据，并将 bundle 中的问题与已导入的产品 KB 进行匹配。

## 项目作用

- 上传 Longhorn 或 Harvester support bundle。
- 自动生成产品 inventory、finding、finding group 和关键日志证据。
- 在报告中直接打开相关文件和匹配到的日志行。
- 导入产品 KB，并构建本地向量索引。
- 将 bundle 中的问题与已导入的 KB 文章进行匹配。
- 在配置 Gemini 后生成 AI Advisor 排障建议。

## 演示视频

### 上传 Bundle 并查看分析结果

<video src="docs/assets/videos/support-bundle-analysis-demo.mov" controls width="100%"></video>

[直接打开视频](docs/assets/videos/support-bundle-analysis-demo.mov)

### 导入 KB 并构建向量索引

<video src="docs/assets/videos/kb-vector-index-demo.mov" controls width="100%"></video>

[直接打开视频](docs/assets/videos/kb-vector-index-demo.mov)

## 本地运行

```bash
npm run dev
```

然后打开：

```text
http://127.0.0.1:3000
```

## 深入了解

- [项目详细文档](docs/project-guide.md)
