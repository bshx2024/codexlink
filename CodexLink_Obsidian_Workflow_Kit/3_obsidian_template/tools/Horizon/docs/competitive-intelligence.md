# Horizon 竞品情报系统 (Competitive Intelligence)

## 概述

Horizon 现在内置了完整的竞品情报（Competitive Intelligence, CI）模块，可自动从多个数据源采集竞品动态，通过 AI 分类和打分，并生成结构化的竞品情报简报。

## 快速开始

### 1. 启用 CI 模块

在 `data/config.json` 中添加 `competitive_intelligence` 配置节：

```json
{
  "competitive_intelligence": {
    "enabled": true,
    "competitors": [...],
    "producthunt": {...},
    "googlenews": {...},
    "web_monitoring": {...}
  }
}
```

参考 `data/config.ci.example.json` 获取完整示例。

### 2. 运行 CI 模式

```bash
# 方法一：默认模式（标准日报 + CI 分析）
uv run horizon --hours 24

# 方法二：CI 专用模式（只跑竞品分析，省去日总结）
uv run horizon --mode ci --hours 24

# 或使用别名
uv run horizon --ci-only --hours 24
```

## 架构说明

### 数据流

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  数据采集层      │ ──► │  AI 分析层    │ ──► │  输出层           │
│                 │     │              │     │                  │
│ ├ RSS 订阅      │     │ ├ 通用打分    │     │ ├ 日报 summary    │
│ ├ GitHub        │     │ ├ CI 分类     │     │ ├ CI 竞品简报      │
│ ├ Reddit        │     │ ├ 信号类型    │     │ ├ webhook 通知     │
│ ├ Telegram      │     │ ├ 影响评分    │     │ └ Obsidian 笔记   │
│ ├ Product Hunt  │     │ └ SWOT 分析   │     │                  │
│ ├ Google News   │     │              │     │                  │
│ ├ Web 变更监控  │     │              │     │                  │
│ └ Hacker News   │     │              │     │                  │
└─────────────────┘     └──────────────┘     └──────────────────┘
```

### 新增模块

| 模块 | 文件 | 说明 |
|------|------|------|
| CI 分析器 | `src/ai/ci_analyzer.py` | 信号分类、影响评分、SWOT 生成 |
| Product Hunt 采集 | `src/scrapers/producthunt.py` | 新产品/公司追踪 |
| Google News 采集 | `src/scrapers/googlenews.py` | 关键词新闻采集 |
| Web 变更监控 | `src/scrapers/webchange.py` | 网站内容变化检测 |
| 竞品模型 | `src/models.py` | SignalType、CompetitorConfig 等 |

## 配置详解

### competitive_intelligence 顶级字段

```json
{
  "enabled": true,
  "competitors": [...],
  "producthunt": {...},
  "googlenews": {...},
  "web_monitoring": {...}
}
```

### CompetitorConfig

```json
{
  "name": "Anthropic",
  "slug": "anthropic",
  "enabled": true,
  "tags": ["ai-llm", "api-provider"],
  "signal_types": ["product_launch", "pricing_change"],
  "sources": {
    "rss": [...],
    "github_repos": [...],
    "twitter_users": [...],
    "reddit_subreddits": [...],
    "news_keywords": [...],
    "web_pages": [...]
  }
}
```

#### 可用字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 竞品显示名称 |
| `slug` | string | 唯一标识符（用于文件命名、匹配） |
| `tags` | string[] | 分类标签 |
| `signal_types` | string[] | 关注的信号类型（留空=全部） |
| `sources.rss` | string[] | 竞品博客 RSS 订阅地址 |
| `sources.github_repos` | string[] | 格式: "owner/repo" |
| `sources.github_users` | string[] | GitHub 用户名 |
| `sources.twitter_users` | string[] | Twitter 用户句柄 |
| `sources.reddit_subreddits` | string[] | 子版块名 |
| `sources.news_keywords` | string[] | Google News 搜索关键词 |
| `sources.web_pages` | string[] | 监控变化的网页 URL |
| `sources.producthunt_slug` | string | Product Hunt 公司 slug |

### SignalType 信号类型

| 信号类型 | 说明 |
|----------|------|
| `product_launch` | 新产品/功能发布 |
| `pricing_change` | 定价/套餐变更 |
| `funding` | 融资/投资活动 |
| `hiring` | 关键招聘/团队扩张 |
| `partnership` | 战略合作 |
| `acquisition` | 并购活动 |
| `technical_release` | 开源/技术发布 |
| `community_sentiment` | 社区情绪/用户反馈 |
| `marketing_move` | 品牌/营销变动 |
| `regulatory` | 合规/监管 |
| `customer_win` | 客户案例/企业签约 |
| `leadership` | 高管变动 |
| `rebrand` | 品牌重塑 |
| `content` | 思想领导力内容 |
| `general` | 其他 |

### Web 变更监控

```json
{
  "web_monitoring": {
    "enabled": true,
    "targets": [
      {
        "url": "https://openai.com/pricing",
        "name": "OpenAI Pricing",
        "enabled": true,
        "selector": ".pricing-table",
        "keywords": ["price", "price change"]
      }
    ]
  }
}
```

- `selector`: CSS 选择器，用于限定监控区域（留空=监控整个页面）
- `keywords`: 关键词匹配（页面包含这些词时触发告警，无论内容是否变更）

### 输出产物

运行后会生成以下文件：

```
data/
├── summaries/
│   ├── horizon-2026-05-31-en.md    # 英文日报
│   └── horizon-2026-05-31-zh.md    # 中文日报
└── ci-reports/
    └── ci-briefing-2026-05-31.md   # 竞品情报简报
```

### CI 简报内容结构

竞品简报包含以下板块：

1. **Executive Summary** — 执行摘要
2. **Key Developments** — 按竞品分组的重点动态（含战略重要性评分）
3. **Threats** — 威胁预警（含严重程度评分）
4. **Opportunities** — 机会洞察
5. **Recommendations** — 行动建议（按优先级排列）
6. **Raw Signals** — 原始信号数据

## 扩展指南

### 添加新的竞品数据源

继承 `BaseScraper` 并实现 `fetch(since)` 方法：

```python
from .base import BaseScraper
from ..models import ContentItem

class CustomScraper(BaseScraper):
    async def fetch(self, since):
        # 实现采集逻辑
        return []  # 返回 ContentItem 列表
```

然后在 `orchestrator.py` 的 `fetch_all_sources` 中注册。

### 自定义信号类型

1. 在 `models.py` 的 `SignalType` 枚举中添加新类型
2. 在 `src/ai/prompts.py` 的 `CI_ANALYSIS_SYSTEM` 中添加说明
3. 可选：在 `CompetitorConfig.signal_types` 中配置
