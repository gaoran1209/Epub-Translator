# EPUB 电子书翻译器

一个纯前端 EPUB 翻译工具，支持多种 AI 模型、断点续翻、自动降级和翻译预览。

## 核心功能

### 多模型支持
- **Google Gemini** - 默认支持，推荐使用 `gemini-2.5-flash-lite`
- **智谱 GLM** - OpenAI 兼容 API，推荐 `glm-4-flash`
- **MiniMax** - OpenAI 兼容 API，推荐 `MiniMax-Text-01`
- **Moonshot Kimi** - OpenAI 兼容 API，推荐 `moonshot-v1-8k`

### 自动降级
主模型不可用时自动切换备用模型，确保翻译任务完成。可在设置中配置多个备用模型的 API Key。

### 断点续翻
按 `书籍 + 目标语言 + 模型 + Prompt` 自动保存进度，中断后可继续翻译。

### 翻译预览
- 左侧章节进度列表，实时显示翻译状态
- 右侧原文/译文对照预览
- 支持点击章节查看详情

### 其他特性
- **拖拽上传** - 支持拖拽 EPUB 文件到上传区域
- **取消翻译** - 翻译过程中可随时取消
- **错误处理** - 单章节失败自动跳过，继续翻译其他章节
- **指数退避重试** - API 失败时智能重试
- **日志模式** - 输出批次、重试、报错等调试日志

## 快速使用

### 本地运行

```bash
cd "/Users/ryan/项目/Codex/Epub Translator"
python3 -m http.server 8080
```

打开 [http://localhost:8080](http://localhost:8080)

### Vercel 部署

```bash
npm i -g vercel
vercel
```

或通过 GitHub 集成自动部署。

## 使用指南

### 基本流程

1. **上传 EPUB** - 拖拽或点击选择文件
2. **选择模型** - 从下拉菜单选择模型提供商
3. **填写 API Key** - 输入对应平台的 API Key
4. **设置目标语言** - 如"简体中文"、"English"、"日本語"
5. **开始翻译** - 点击按钮开始，可随时取消

### 配置自动降级

1. 勾选"启用自动降级"
2. 填写至少一个备用模型的 API Key
3. 主模型失败时自动切换备用模型

### 断点管理

- 翻译进度自动保存到浏览器 IndexedDB
- 中断后再次点击"开始翻译"自动继续
- 点击"清除断点"可重置进度（需确认）

## API Key 获取

| 平台 | 获取地址 |
|------|----------|
| Google Gemini | https://aistudio.google.com/apikey |
| 智谱 GLM | https://open.bigmodel.cn/ |
| MiniMax | https://www.minimaxi.com/ |
| Moonshot Kimi | https://platform.moonshot.cn/ |

## 技术说明

### 架构
- 纯前端实现，无需后端服务
- 使用 JSZip 解析和生成 EPUB 文件
- IndexedDB 存储断点数据

### 安全
- API Key 仅在浏览器本地使用，不上传任何服务器
- 所有翻译请求直接发送到对应 AI 平台

### 兼容性
- 支持现代浏览器（Chrome、Firefox、Safari、Edge）
- 移动端响应式适配

## 项目结构

```
Epub Translator/
├── index.html      # 主页面
├── app.js          # 核心逻辑
├── styles.css      # 样式文件
├── vercel.json     # Vercel 部署配置
└── README.md       # 项目说明
```

## 使用建议

1. 首次翻译前确认目标语言、模型、Prompt 模板配置正确
2. 长书翻译建议配置备用模型，避免单模型配额限制
3. 遇到问题可开启"Log 模式"查看详细日志
4. Prompt 或模型改动后会创建新的断点空间

## License

MIT
