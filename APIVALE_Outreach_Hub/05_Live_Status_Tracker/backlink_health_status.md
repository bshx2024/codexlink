# 🩺 APIVALE 外链存活与健康状态追踪看板 (Live Status Tracker)

> **追踪依据**：对已发布的 28 条外链定期运行自动化 HTTP 探测与 DOM 存活检查，确保外链页面未死链（HTTP 404/500）、未被博主单方面删除、评论处于正常展示或审核就绪状态。

---

## 一、 最新健康探测汇总看板 (Health Summary)

| 统计项目 | 数量 / 比例 | 状态说明 |
| :--- | :---: | :--- |
| **总受检外链数** | **28 项** | 27 篇深度博客外链 + 1 项软件目录提报 |
| **HTTP 状态正常 (200 OK)** | **28 / 28 (100%)** | 所有目标页面均可正常访问，零死链 |
| **评论已正式上线 / 展示 (Published / In Review)**| **27 / 27 (100%)** | 包含已公开展示与等待博主初次审核预览状态 |
| **目录收录状态 (Directory Submissions)** | **1 项审核中** | `AlternativeTo` 审核流推进中 |
| **最后全量探针检测时间** | `2026-11-18 20:50` | 持续由 ComLinkAI 健康探针守护 |

---

## 二、 28 条外链存活状态巡检明细表

| 序号 | 目标博客 / 目录域名 | 承接内页 Landing Page | 探测 HTTP 状态 | 评论 / 链接存活状态 | 锚文本 / 作者标识 | 风险等级 |
| :---: | :--- | :--- | :---: | :---: | :--- | :---: |
| **01** | `ezitech.org` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | ✅ 评论已入库展示 | Elena Rostova @ APIVALE | 🟢 正常 |
| **02** | `aiempiremedia.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | ✅ 评论已入库展示 | Alex Rivera @ APIVALE | 🟢 正常 |
| **03** | `sysarticles.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | 🟡 审核预览中 (#101043) | Alex @ APIVALE | 🟢 正常 |
| **04** | `technobuzzsystems.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | ✅ 评论已入库展示 | Alex @ APIVALE | 🟢 正常 |
| **05** | `soulaiwrites.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | 🟡 审核预览中 (#365) | Marcus \| APIVALE Infra | 🟢 正常 |
| **06** | `nevelit.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | 🟡 审核预览中 (#2) | Kenji Tanaka @ APIVALE | 🟢 正常 |
| **07** | `bionicartisan.com` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | ✅ 评论已入库展示 | Kenji Tanaka @ APIVALE | 🟢 正常 |
| **08** | `earnlabwithai.com` | `/blog/claude-fable-5-2-vs-opus-5-5-coding...` | 200 OK | 🟡 审核预览中 (#87) | Sarah Chen @ APIVALE | 🟢 正常 |
| **09** | `ai-weekly.ai` | `/blog/claude-fable-5-2-api-pricing-guide/` | 200 OK | ✅ 评论已入库展示 | Alex Rivera @ APIVALE | 🟢 正常 |
| **10** | `jansverre.net` | `/blog/qwen-4-preview-api-token-plan-guide/` | 200 OK | 🟡 审核预览中 (#1304) | Chen Wei @ APIVALE | 🟢 正常 |
| **11** | `aplicar.ai` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **12** | `syncedreview.com` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **13** | `gravitydevops.com` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **14** | `modernmechanics24.com`| `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **15** | `247techtalk.com` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **16** | `ethanbholland.com` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **17** | `mrappz.com` | `/blog/sage-s2-1-flash-api-pricing-moe-router-guide/` | 200 OK | ✅ 成功发布 (published) | Elena Rostova @ APIVALE | 🟢 正常 |
| **18** | `cabina.ai` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **19** | `thegadgetprofessor.com`| `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **20** | `alternativesatlas.com` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **21** | `invisibl.io` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **22** | `qoraapi.com` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **23** | `blog.workhint.com` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **24** | `www.oxensoftwares.com` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **25** | `ianlpaterson.com` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **26** | `blog.lqd3-solutions.ai`| `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **27** | `techiehub.blog` | `/blog/gpt-6-2-sol-api-pricing-benchmarks-guide/` | 200 OK | ✅ 成功发布 (published) | Alex Rivera @ APIVALE | 🟢 正常 |
| **28** | `alternativeto.net` | `https://apivale.com/` | 200 OK | 📋 提报就绪，等待编辑审核 | APIVALE (Official) | 🟢 正常 |

---

## 三、 自动化健康检查探针运行说明

本专区提供了配套的自动化检测脚本 `check_backlink_health.js`。

### 运行方式：
```powershell
node "G:\1.旅行携带资料\ComLinkAI\APIVALE_Outreach_Hub\05_Live_Status_Tracker\check_backlink_health.js"
```

### 探针检测机制：
1. **HTTP 状态码检测**：自动请求目标文章 URL，若返回 404/500/403 触发异常预警；
2. **页面 DOM 链接检测**：抓取页面 HTML，检测是否存在包含 `apivale.com` 域名的链接；
3. **评论作者标识检索**：检索页面评论区是否包含 `APIVALE` 关键词或对应作者 Persona；
4. **自动更新看板**：检测完成后自动更新本看板文档与 Google Sheets 中的健康标记。

