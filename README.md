# Automations

独立的插件采集与翻译流水线。网站、API、D1 和 R2 由 ChatGPT Sites 承载。

## Actions

- 仅保留 catalog-sync.yml 生产工作流：collect → translate → publish。检查并入各 job，原诊断和独立检查工作流已移除。
- 每天北京时间 08:00 采集；12:00、16:00、20:00 独立补译待译队列。也支持手动 incremental、full、translate、sync。
- 仅对有正文且原文哈希没有有效译文的记录启动翻译；没有待译项就跳过。data/published.json 仅在 Sites 同步成功后记录版本，版本未变化时跳过发布。push 代码变更仅检查和同步，不消耗翻译配额。
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

## Translation quality (revision 2)

Workers AI accepts object or string final responses and never downgrades to M2M100. Stable segment IDs and bounded line/sentence chunks preserve ordering. A glossary, protected-name/number/URL checks and targeted permission/cost checks reject known failure classes; these are deterministic checks, not a guarantee of semantic correctness. Historical translations remain pending until revision 2 checks or editorial review. Eight source-hash-bound reviewed repairs are applied before translation.

The existing workflow resumes a fixed, stratified 50-plugin benchmark for Qwen3, Mistral Small and Gemma 4 under identical prompts. Each sample contains its short summary and one complete selected body chunk, rather than its entire long description. It processes at most 30 attempts/20 minutes per run, respects account-wide official quota, and saves progress in `data/translation-benchmark.json`. Reported check pass rates are not human quality scores. Existing schedules and account-wide 8,500-Neuron safety limits remain in effect.
