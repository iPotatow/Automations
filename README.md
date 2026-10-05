# Automations

独立的插件采集与翻译流水线。网站、API、D1 和 R2 由 ChatGPT Sites 承载。

## Actions

- 每天北京时间 08:23 运行；也支持手动 incremental、full、translate、sync。
- 保留 16 分类扫描、详情提取、重试与退避、异常减量保护、断点续跑。
- 翻译由 Actions 直接调用 Cloudflare Workers AI；原文哈希、段落校验、译文缓存、并发和配额保护保持有效。external 模式支持原有 Chat Completions 服务。
- 进度每五分钟及结束时提交 main 的 data/；数据提交不触发采集循环。并发任务串行运行，更新 main 使用 rebase 后普通 push，禁止强推覆盖新代码。
- main 的 data/state.json 保存原文、译文、缓存与任务状态；data/manifest.json 和 exports/ 提供带 SHA-256 的发布快照。每次读取固定 commit，历史快照通过 Git commit 定位。
- 同步按发布 commit 调用 Sites 后台接口；Sites 验证分片后分批写入，完成才切换线上 generation。

## 配置

Repository Variables：SITE_BASE_URL（Sites 地址）、CLOUDFLARE_ACCOUNT_ID；可选 WORKERS_AI_MODEL、AI_CONCURRENCY、AI_TRANSLATION_LIMIT、CLOUDFLARE_AI_DAILY_NEURON_LIMIT。

Repository Secrets：CLOUDFLARE_API_TOKEN（Workers AI 执行及 Analytics 读取权限）、SITES_SERVICE_TOKEN（私有 Sites 服务访问令牌）。同步仍单独校验 GitHub OIDC，限定本仓库 ID、main 和 catalog-sync.yml。

external 翻译后端需 AI_TRANSLATION_BACKEND=external，并配置 AI_API_KEY、AI_BASE_URL、AI_MODEL。

## 验证

运行 npm test。浏览器采集使用 .github/scripts/chatgpt-plugins/package-lock.json 安装锁定依赖。失败及未补齐记录保持 pending，不宣称全量已完成。
