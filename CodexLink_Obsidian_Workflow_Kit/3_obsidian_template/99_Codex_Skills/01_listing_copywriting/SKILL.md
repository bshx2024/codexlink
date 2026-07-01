---
name: listing_copywriting
description: "亚马逊Listing文案打造：基于A9/A10、Cosmo、Rufus AI等多重算法，生成高质量、高转化的Listing文案。包含关键词研究、竞品分析、标题优化、五点描述、产品描述、后台关键词等全流程工作流。"
version: 1.0.0
requires:
  bins: ["python3"]
  api_services: ["amazon_keywords_api", "competitor_data_api"]
---

# Listing文案打造 Skill

## 1. 业务逻辑

### 1.1 核心目标
- 同时迎合亚马逊A9/A10传统搜索逻辑、Cosmo算法、Rufus AI搜索逻辑。
- 确保Listing在关键词检索、内容理解、用户表达、页面转化、AI搜索场景下均有优秀表现。
- 用AI将原本依赖个人经验的文案工作流程化、标准化、自动化。

### 1.2 关键成功因素
- **数据驱动**：所有文案决策基于真实搜索数据、竞品数据和用户行为数据。
- **算法适配**：每个文案元素（标题、五点、描述、后台关键词）都针对特定算法优化。
- **用户中心**：文案必须解决用户痛点，激发购买欲望，而非单纯堆砌关键词。
- **多版本迭代**：生成多个版本进行A/B测试，持续优化。

### 1.3 工作流概述
1. **数据收集**：获取核心关键词、长尾词、竞品Listing数据、类目趋势。
2. **关键词研究**：分析搜索量、竞争度、相关性，确定核心关键词与语义集群。
3. **竞品分析**：拆解Top 10竞品的文案结构、关键词布局、卖点表达。
4. **文案生成**：基于数据和算法规则，生成标题、五点描述、产品描述、A+内容。
5. **后台优化**：提取高价值但未使用的关键词，填充后台搜索词。
6. **校验与迭代**：检查文案合规性、可读性、SEO效果，生成优化报告。

## 2. 数据需求

### 2.1 必需数据
- **关键词数据**：核心关键词、长尾词、搜索量、竞争度、点击率、转化率。
- **竞品数据**：Top 10-20竞品的标题、五点、描述、价格、排名、评论数。
- **产品数据**：产品功能、材质、尺寸、使用场景、独特卖点。
- **类目数据**：类目趋势、季节性、主要品牌、价格区间。

### 2.2 数据来源
- 亚马逊品牌分析（ABA）
- 第三方关键词工具（Helium 10, Jungle Scout, DataDive等）
- 竞品页面爬取（遵守robots.txt）
- 内部运营数据

## 3. 工作流步骤

### 步骤1：数据输入与预处理
```bash
# 调用数据预处理脚本，清洗和格式化输入数据
python3 scripts/data_preprocessing.py --input raw_data/ --output processed/
```

### 步骤2：关键词研究与聚类
```bash
# 分析关键词，生成关键词矩阵
python3 scripts/keyword_analysis.py --input processed/keywords.csv --output processed/keyword_matrix.json
```

### 步骤3：竞品分析与基准设定
```bash
# 分析竞品Listing，提取最佳实践
python3 scripts/competitor_analysis.py --input processed/competitors.csv --output processed/competitor_insights.json
```

### 步骤4：文案生成（AI核心）
```bash
# 使用AI生成多版本文案
python3 scripts/copy_generation.py --keywords processed/keyword_matrix.json --competitors processed/competitor_insights.json --output drafts/
```

### 步骤5：文案优化与校验
```bash
# 优化文案，确保算法适配和可读性
python3 scripts/copy_optimization.py --input drafts/ --output optimized/
```

### 步骤6：输出报告与部署
```bash
# 生成最终文案文件和优化报告
python3 scripts/report_generation.py --input optimized/ --output final/
```

## 4. AI提示词模板

### 4.1 标题生成提示词
```
你是一位资深的亚马逊Listing优化专家，拥有15年跨境电商运营经验。

任务：基于以下数据，生成5个不同风格的亚马逊产品标题。

产品信息：
- 产品类型：{product_type}
- 核心功能：{core_features}
- 目标用户：{target_audience}
- 价格区间：{price_range}

关键词数据：
- 核心关键词（按重要性排序）：{core_keywords}
- 长尾关键词：{long_tail_keywords}
- 高转化但竞争低的词：{high_converting_low_comp}

竞品标题分析：
{competitor_titles_analysis}

要求：
1. 标题长度：150-200字符（包括空格）
2. 结构：品牌名 + 核心关键词 + 关键特性 + 目标用户/场景 + 差异化卖点
3. 同时考虑A9/A10关键词权重、Cosmo语义理解、Rufus AI搜索匹配
4. 避免关键词堆砌，确保可读性和吸引力
5. 每个标题突出不同的卖点组合
6. 使用英文，符合亚马逊政策

输出格式：
标题1: [标题内容] | 突出卖点: [卖点]
标题2: [标题内容] | 突出卖点: [卖点]
...
```

### 4.2 五点描述生成提示词
```
基于以下信息，生成亚马逊产品五点描述（Bullet Points）。

产品核心信息：
{product_info}

关键词矩阵：
{keyword_matrix}

竞品五点描述最佳实践：
{competitor_bullets_analysis}

用户痛点与需求：
{user_pain_points}

要求：
1. 每个要点60-150字符
2. 每个要点以【核心关键词】开头，后跟功能描述和用户利益
3. 结构：【关键词】功能特性 → 用户利益 → 使用场景
4. 覆盖A10看重的：关键词密度、语义相关性、用户意图匹配
5. 适配Cosmo算法：使用自然语言，包含同义词和相关概念
6. 考虑Rufus AI：包含问题回答式表达（如"Need...?"开头）
7. 总共5个要点，覆盖：核心功能、材质/质量、使用体验、适用场景、售后保障

输出格式：
要点1: 【关键词】具体内容 | 对应算法优化点
要点2: 【关键词】具体内容 | 对应算法优化点
...
```

### 4.3 产品描述生成提示词
```
撰写一段引人入胜的亚马逊产品描述。

产品信息：
{product_details}

品牌故事：
{brand_story}

目标客户画像：
{customer_persona}

关键词布局：
- 必须包含的关键词：{must_include_keywords}
- 自然融入的语义词：{semantic_terms}

要求：
1. 长度：1000-2000字符
2. 结构：开头痛点共鸣 → 产品解决方案 → 详细功能 → 使用场景 → 行动号召
3. 融入情感元素，建立与消费者的连接
4. 使用第二人称（你/您的），增强代入感
5. 包含2-3个客户使用场景的简短故事
6. 自然分布关键词，避免堆砌
7. 结尾有明确的CTA（Call to Action）

输出格式：
[产品描述正文]

关键词密度报告：
- 核心关键词：出现X次
- 长尾关键词：出现Y次
- 语义相关词：出现Z次
```

## 5. 输出格式

### 5.1 最终文案文件结构
```
final/
├── listing_en.json          # 完整Listing（英文）
├── listing_en.txt           # 纯文本版本
├── title_variants/          # 标题变体
│   ├── title_1.txt
│   └── ...
├── bullet_points/           # 五点描述
│   └── bullets.txt
├── description/             # 产品描述
│   └── description.txt
├── backend_keywords/        # 后台关键词
│   └── search_terms.txt
└── optimization_report.md   # 优化报告
```

### 5.2 优化报告内容
- **关键词覆盖率**：已使用关键词 vs. 目标关键词列表
- **算法适配评分**：A9/A10、Cosmo、Rufus各自评分
- **可读性评估**：Flesch阅读难易度、句子复杂度
- **竞品对标分析**：与Top 5竞品的差异化程度
- **A/B测试建议**：推荐测试的文案变体

## 6. 集成说明

### 6.1 与Codex CLI集成
```bash
# 完整工作流一键执行
codex run listing_copywriting --product-id B0XXXXXXXX --market US

# 单独执行某个步骤
codex run listing_copywriting/step3 --input processed/competitors.csv
```

### 6.2 与其他模块的关联
- **选品模块**：选品结果作为Listing输入
- **图片生成模块**：文案卖点指导图片设计
- **广告模块**：关键词数据用于广告投放

## 7. 注意事项
1. **合规性**：确保文案不违反亚马逊政策（无夸大、无对比、无诱导评论）
2. **本地化**：针对不同市场（US、UK、DE、JP等）调整语言风格
3. **版权**：避免直接复制竞品文案，使用AI重新表达
4. **持续优化**：每月根据销售数据和搜索趋势更新文案
