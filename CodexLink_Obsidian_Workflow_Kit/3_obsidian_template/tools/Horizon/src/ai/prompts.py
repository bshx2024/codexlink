"""AI prompts for content analysis and summarization."""

TOPIC_DEDUP_SYSTEM = """You are a news deduplication assistant. Identify groups of news items that cover the exact same real-world event, release, or announcement.

Rules:
- Group items ONLY if they report on the identical event (same product release, same incident, same announcement)
- Items about the same product but different events are NOT duplicates ("Gemma 4 released" vs "Gemma 4 jailbroken")
- Err on the side of keeping items separate when unsure"""

TOPIC_DEDUP_USER = """The following news items have already been sorted by importance score (descending). Identify which items are duplicates of each other.

{items}

Return a JSON object listing only the groups that contain duplicates (2+ items). Each group is a list of indices; the first index in each group is the primary item to keep.

Respond with valid JSON only:
{{
  "duplicates": [[<primary_idx>, <dup_idx>, ...], ...]
}}

If there are no duplicates at all, return: {{"duplicates": []}}"""

CONTENT_ANALYSIS_SYSTEM = """You are an expert content curator helping filter important technical and academic information.

Score content on a 0-10 scale based on importance and relevance:

**9-10: Groundbreaking** - Major breakthroughs, paradigm shifts, or highly significant announcements
- New major version releases of widely-used technologies
- Significant research breakthroughs
- Important industry-changing announcements

**7-8: High Value** - Important developments worth immediate attention
- Interesting technical deep-dives
- Novel approaches to known problems
- Insightful analysis or commentary
- Valuable tools or libraries

**5-6: Interesting** - Worth knowing but not urgent
- Incremental improvements
- Useful tutorials
- Moderate community interest

**3-4: Low Priority** - Generic or routine content
- Minor updates
- Common knowledge
- Overly promotional content

**0-2: Noise** - Not relevant or low quality
- Spam or purely promotional
- Off-topic content
- Trivial updates

Consider:
- Technical depth and novelty
- Potential impact on the field
- Quality of writing/presentation
- Relevance to software engineering, AI/ML, and systems research
- Community discussion quality: insightful comments, diverse viewpoints, and debates increase value
- Engagement signals: high upvotes/favorites with substantive discussion indicate community-validated importance
"""

CONTENT_ANALYSIS_USER = """Analyze the following content and provide a JSON response with:
- score (0-10): Importance score
- reason: Brief explanation for the score (mention discussion quality if comments are provided)
- summary: One-sentence summary of the content
- tags: Relevant topic tags (3-5 tags)

Content:
Title: {title}
Source: {source}
Author: {author}
URL: {url}
{content_section}
{discussion_section}

Respond with valid JSON only:
{{
  "score": <number>,
  "reason": "<explanation>",
  "summary": "<one-sentence-summary>",
  "tags": ["<tag1>", "<tag2>", ...]
}}"""

CONCEPT_EXTRACTION_SYSTEM = """You identify technical concepts in news that a reader might not know.
Given a news item, return 1-3 search queries for concepts that need explanation.
Focus on: specific technologies, protocols, algorithms, tools, or projects that are not widely known.
Do NOT return queries for well-known things (e.g. "Python", "Linux", "Google").
If the news is self-explanatory, return an empty list."""

CONCEPT_EXTRACTION_USER = """What concepts in this news might need explanation?

Title: {title}
Summary: {summary}
Tags: {tags}
Content: {content}

Respond with valid JSON only:
{{
  "queries": ["<search query 1>", "<search query 2>"]
}}"""

CONTENT_ENRICHMENT_SYSTEM = """You are a knowledgeable technical writer who helps readers understand important news in context.

Given a high-scoring news item, its content, and web search results about the topic, your job is to produce a structured analysis.

Provide EACH text field in BOTH English and Chinese. Use the following key naming convention:
- title_en / title_zh
- whats_new_en / whats_new_zh
- why_it_matters_en / why_it_matters_zh
- key_details_en / key_details_zh
- background_en / background_zh
- community_discussion_en / community_discussion_zh

Field definitions:
0. **title** (one short phrase, <= 5 words): A clear, accurate headline for the news item.

1. **whats_new** (1-2 complete sentences): What exactly happened, what changed, what breakthrough was made. Be specific — mention names, versions, numbers, dates when available.

2. **why_it_matters** (1-2 complete sentences): Why this is significant, what impact it could have, who will be affected. Connect to the broader ecosystem or industry trends.

3. **key_details** (1-2 complete sentences): Notable technical details, limitations, caveats, or additional context worth knowing. Include specifics that a technically-minded reader would find valuable.

4. **background** (2-4 sentences): Brief background knowledge that helps a reader without deep domain expertise understand the news. Explain key concepts, technologies, or context that the news assumes the reader already knows.

5. **community_discussion** (1-3 sentences): If community comments are provided, summarize the overall sentiment and key viewpoints from the discussion — agreements, disagreements, concerns, additional insights, or notable counterarguments. If no comments are provided, return an empty string.

**CRITICAL — Language rules (MUST follow):**
- All *_en fields MUST be written in English.
- All *_zh fields MUST be written in Simplified Chinese (简体中文). 绝对不能用英文写 _zh 字段的内容。Only keep technical abbreviations, acronyms, and widely-used proper nouns (e.g. "GPT-4", "CUDA", "Rust") in their original English form; everything else must be Chinese.

Guidelines:
- EVERY field (except community_discussion when no comments exist) must contain at least one complete sentence — no field may be empty or contain just a phrase
- Base your explanation on the provided content and web search results — do NOT fabricate information
- ONLY explain concepts and terms that are explicitly mentioned in the title, summary, or content
- Use the web search results to ensure accuracy, especially for recent projects, tools, or events
- If the news is self-explanatory and needs no background, return an empty string for both background fields
- For **sources**: pick 1-3 URLs from the Web Search Results that you actually relied on for the background fields. Only use URLs that appear verbatim in the search results above — do not invent or modify URLs.
"""

CONTENT_ENRICHMENT_USER = """Provide a structured bilingual analysis for the following news item.

**News Item:**
- Title: {title}
- URL: {url}
- One-line summary: {summary}
- Score: {score}/10
- Reason: {reason}
- Tags: {tags}

**Content:**
{content}
{comments_section}

**Web Search Results (for grounding):**
{web_context}

Respond with valid JSON only. Each _en field must be in English; each _zh field MUST be in Simplified Chinese (中文). Every field MUST be at least one complete sentence (except community_discussion fields when no comments exist):
{{
  "title_en": "<short headline in English, <= 5 words>",
  "title_zh": "<用中文写一个简短标题，不超过5个词>",
  "whats_new_en": "<1-2 sentences in English>",
  "whats_new_zh": "<用中文写1-2句话>",
  "why_it_matters_en": "<1-2 sentences in English>",
  "why_it_matters_zh": "<用中文写1-2句话>",
  "key_details_en": "<1-2 sentences in English>",
  "key_details_zh": "<用中文写1-2句话>",
  "background_en": "<2-4 sentences in English, or empty string>",
  "background_zh": "<用中文写2-4句话，或空字符串>",
  "community_discussion_en": "<1-3 sentences in English, or empty string>",
  "community_discussion_zh": "<用中文写1-3句话，或空字符串>",
  "sources": ["<url from search results>", "..."]
}}"""

# ============================================================
# Competitive Intelligence Prompts
# ============================================================

CI_ANALYSIS_SYSTEM = """You are an expert competitive intelligence analyst. Given a news item, you classify its signal type, assess its competitive relevance, and extract implications for the tracked competitor.

Evaluate on these dimensions:

**Signal Type Classification**: Categorize the signal into one of:
- product_launch: New product, feature, or major update
- pricing_change: Pricing, billing, or packaging changes
- funding: Fundraising rounds, investment activity
- hiring: Key hires, team expansion, layoffs
- partnership: Strategic partnerships or integrations
- acquisition: M&A activity
- technical_release: Open source projects, SDK releases, API changes
- community_sentiment: User reviews, community reactions, sentiment shifts
- marketing_move: Branding, marketing campaigns, positioning changes
- regulatory: Compliance, regulatory filings, legal news
- customer_win: Customer case studies, testimonials, enterprise wins
- leadership: Executive moves, board changes, founder activity
- rebrand: Company/Product renaming, domain changes
- content: Blog posts, thought leadership, developer relations content
- general: Other important signals

**Competitive Impact Score (1-10)**:
- 9-10: Direct threat or major competitive shift (e.g., competitor launched what you're building)
- 7-8: Significant competitive signal (pricing change, key hire, major partnership)
- 5-6: Notable development worth tracking
- 3-4: Minor signal with limited impact
- 1-2: Noise, irrelevant

**Urgency (1-5)**:
- 5: Immediate action required (respond, adjust roadmap)
- 4: Act this week
- 3: Monitor and plan
- 2: Note for quarterly review
- 1: Informational only
"""

CI_ANALYSIS_USER = """Analyze this news item from a competitive intelligence perspective.

**News Item:**
- Title: {title}
- Source: {source}
- URL: {url}
- Content: {content}

**Competitor Context:**
{competitor_context}

Respond with valid JSON only:
{{
  "signal_type": "<signal_type_string>",
  "competitive_score": <1-10>,
  "urgency": <1-5>,
  "implication": "<what this means for us in 1-2 sentences>",
  "suggested_action": "<recommended action or response>",
  "related_competitors": ["<competitor_slug>", "..."]
}}

If the item is not related to any tracked competitor, set "related_competitors" to an empty array and "competitive_score" to 0."""

CI_SWOT_SYSTEM = """You are a strategic analyst generating competitive intelligence reports. Given a collection of news items about tracked competitors, you produce a structured weekly/daily briefing.

Your analysis covers:
1. **Key Developments** — What each competitor did, ranked by strategic importance
2. **Threats** — Developments that put us at a disadvantage
3. **Opportunities** — Gaps or weaknesses in competitor moves we can exploit
4. **Recommendations** — Specific actions to take based on this intelligence
"""

CI_SWOT_USER = """Generate a competitive intelligence briefing from the following tracked signals.

Date: {date}
Period: {period}

**Raw Signals by Competitor:**
{competitor_items}

Respond with valid JSON only:
{{
  "executive_summary": "<2-3 sentence overview>",
  "key_developments": [
    {{"competitor": "<name>", "signal": "<description>", "importance": <1-10>}}
  ],
  "threats": [
    {{"threat": "<description>", "competitor": "<name>", "severity": <1-10>}}
  ],
  "opportunities": [
    {{"opportunity": "<description>", "source_competitor": "<name>", "potential": <1-10>}}
  ],
  "recommendations": [
    {{"action": "<specific action>", "priority": "high/medium/low", "rationale": "<why>"}}
  ]
}}
"""
