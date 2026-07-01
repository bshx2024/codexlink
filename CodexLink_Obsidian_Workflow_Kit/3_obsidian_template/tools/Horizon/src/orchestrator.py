"""Main orchestrator coordinating the entire workflow."""

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from urllib.parse import urlparse
import httpx
from rich.console import Console

from .models import Config, ContentItem, SourceType
from .storage.manager import StorageManager
from .services.email import EmailManager
from .services.webhook import WebhookNotifier
from .scrapers.github import GitHubScraper
from .scrapers.hackernews import HackerNewsScraper
from .scrapers.rss import RSSScraper
from .scrapers.reddit import RedditScraper
from .scrapers.telegram import TelegramScraper
from .scrapers.twitter import TwitterScraper
from .scrapers.openbb import OpenBBScraper
from .scrapers.ossinsight import OSSInsightScraper
from .scrapers.producthunt import ProductHuntScraper
from .scrapers.googlenews import GoogleNewsScraper
from .scrapers.webchange import WebChangeScraper
from .ai.client import create_ai_client
from .ai.analyzer import ContentAnalyzer
from .ai.summarizer import DailySummarizer
from .ai.enricher import ContentEnricher
from .ai.ci_analyzer import CompetitiveAnalyzer
from .ai.tokens import get_usage_snapshot


class HorizonOrchestrator:
    """Orchestrates the complete workflow for content aggregation and analysis."""

    def __init__(self, config: Config, storage: StorageManager):
        """Initialize orchestrator.

        Args:
            config: Application configuration
            storage: Storage manager
        """
        self.config = config
        self.storage = storage
        self.console = Console()
        self.email_manager = EmailManager(config.email, console=self.console) if config.email else None
        self.webhook_notifier = (
            WebhookNotifier(config.webhook, console=self.console)
            if config.webhook and config.webhook.enabled
            else None
        )

    async def run(self, force_hours: int = None) -> None:
        """Execute the complete workflow.

        Args:
            force_hours: Optional override for time window in hours
        """
        self.console.print("[bold cyan]\U0001f305 Horizon - Starting aggregation...[/bold cyan]\n")

        # Check email subscriptions if configured
        if (
            self.email_manager
            and self.config.email
            and self.config.email.enabled
            and self.config.email.imap_enabled
        ):
            self.console.print("\U0001f4df Checking for new email subscriptions...")
            self.email_manager.check_subscriptions(self.storage)

        try:
            # 1. Determine time window
            since = self._determine_time_window(force_hours)
            self.console.print(f"\U0001f4ee Fetching content since: {since.strftime('%Y-%m-%d %H:%M:%S')}\n")

            # 2. Fetch content from all sources (including new CI sources)
            all_items = await self.fetch_all_sources(since)
            self.console.print(f"\U0001f4dc Fetched {len(all_items)} items from all sources\n")

            if not all_items:
                self.console.print("[yellow]No new content found. Exiting.[/yellow]")
                return

            # 3. Merge cross-source duplicates (same URL from different sources)
            merged_items = self.merge_cross_source_duplicates(all_items)
            if len(merged_items) < len(all_items):
                self.console.print(
                    f"\U0001f518 Merged {len(all_items) - len(merged_items)} cross-source duplicates "
                    f"\u2192 {len(merged_items)} unique items\n"
                )

            # 4. Analyze with AI
            analyzed_items = await self._analyze_content(merged_items)
            self.console.print(f"\U0001f916 Analyzed {len(analyzed_items)} items with AI\n")

            # 5. Filter by score threshold
            threshold = self.config.filtering.ai_score_threshold
            important_items = [
                item for item in analyzed_items
                if item.ai_score and item.ai_score >= threshold
            ]
            important_items.sort(key=lambda x: x.ai_score or 0, reverse=True)

            self.console.print(
                f"\u2b50 {len(important_items)} items scored \u2265 {threshold}\n"
            )

            # 5.5 Semantic deduplication: drop items covering the same topic
            deduped_items = await self.merge_topic_duplicates(important_items)
            if len(deduped_items) < len(important_items):
                self.console.print(
                    f"\U0001f9f7 Removed {len(important_items) - len(deduped_items)} topic duplicates "
                    f"\u2192 {len(deduped_items)} unique items\n"
                )
            important_items = deduped_items

            # 5.6 Optional second-stage Twitter reply expansion + targeted re-analysis
            await self._expand_twitter_discussion(important_items)

            # Show per-sub-source selection breakdown
            selected_counts: Dict[str, int] = defaultdict(int)
            for item in important_items:
                key = f"{item.source_type.value}/{self._subsource_key(item)}"
                selected_counts[key] += 1
            if selected_counts:
                self.console.print("   Breakdown by source:")
                for key, count in sorted(selected_counts.items()):
                    self.console.print(f"      \u2022 {key}: {count}")
                self.console.print("")

            # ==================== CI MODULE ====================
            # If competitive intelligence is enabled, run CI analysis
            if self._ci_enabled():
                await self._run_ci_pipeline(analyzed_items, since)
            # ===================================================

            # 6. Enrich important items with background knowledge
            await self._enrich_important_items(important_items)

            # 7. Generate and save summaries for each configured language
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            languages = self.config.ai.languages or ["en"]

            for lang in languages:
                summary = await self._generate_summary(
                    important_items, today, len(all_items), language=lang
                )
                self.storage.save_summary(summary, date=today, language=lang)
                self.console.print(f"\U0001f4be Saved {lang.upper()} summary to: data/summaries/horizon-{today}-{lang}.md")

            # 8. Copy to GitHub Pages docs if docs/_posts exists (backwards compat)
            for lang in languages:
                summary_path = self.storage.summaries_dir / f"horizon-{today}-{lang}.md"
                if summary_path.exists():
                    posts_dir = self.storage.data_dir.parent / "docs" / "_posts"
                    if posts_dir.exists():
                        dest = posts_dir / f"{today}-summary-{lang}.md"
                        import shutil
                        shutil.copy2(str(summary_path), str(dest))
                        self.console.print(f"\U0001f4c4 Copied {lang.upper()} summary to GitHub Pages: {dest.relative_to(self.storage.data_dir.parent)}")

            # 9. Send webhook notifications if configured
            if self.webhook_notifier and self.config.webhook and self.config.webhook.enabled:
                self.console.print("\U0001f914 Sending webhook notifications...")
                await self.webhook_notifier.send(important_items, today)
                self.console.print("   Webhook notifications sent\n")

            # 10. Print token usage summary
            snapshot = get_usage_snapshot()
            if snapshot:
                total = snapshot["total"]
                self.console.print(f"\n\U0001f9ee Token usage this run: {total['total_tokens']} tokens (input: {total['input_tokens']}, output: {total['output_tokens']})")
                for provider_key, usage in snapshot.get("providers", {}).items():
                    self.console.print(f"   \u2022 {provider_key}: {usage['total_tokens']} tokens (in: {usage['input_tokens']}, out: {usage['output_tokens']})")

            self.console.print("\n[bold green]\u2705 Horizon completed successfully![/bold green]")

        except KeyboardInterrupt:
            self.console.print("\n[yellow]\u23f3 Interrupted by user[/yellow]")
        except Exception as e:
            self.console.print(f"\n[bold red]\u274c Fatal error: {e}[/bold red]")
            import traceback
            traceback.print_exc()
            raise

    def _ci_enabled(self) -> bool:
        """Check if competitive intelligence module is enabled."""
        ci = self.config.competitive_intelligence
        return ci is not None and ci.enabled and len(ci.competitors) > 0

    def _subsource_key(self, item: ContentItem) -> str:
        """Get a display key for the sub-source of an item."""
        meta = item.metadata
        if item.source_type == SourceType.REDDIT:
            return meta.get("subreddit", meta.get("feed_name", "unknown"))
        elif item.source_type == SourceType.TELEGRAM:
            return meta.get("channel", "unknown")
        elif item.source_type == SourceType.GITHUB:
            return meta.get("repo", meta.get("username", "unknown"))
        elif item.source_type == SourceType.RSS:
            return meta.get("feed_name", "unknown")
        elif item.source_type == SourceType.HACKERNEWS:
            return meta.get("username", "unknown")
        elif item.source_type == SourceType.PRODUCTHUNT:
            return "producthunt"
        elif item.source_type == SourceType.GOOGLENEWS:
            return meta.get("keyword", "googlenews")
        elif item.source_type == SourceType.WEB_CHANGE:
            return meta.get("page_title", "web")
        return item.source_type.value

    async def _run_ci_pipeline(self, all_items: List[ContentItem], since: datetime) -> None:
        """Run competitive intelligence analysis pipeline.

        Args:
            all_items: All analyzed content items (before threshold filtering)
            since: Time window start
        """
        ci_config = self.config.competitive_intelligence
        if not ci_config or not ci_config.enabled:
            return

        self.console.print("\n[bold cyan]\U0001f50d Running Competitive Intelligence analysis...[/bold cyan]\n")

        classified_items: Dict[str, List[ContentItem]] = {}
        ai_client = create_ai_client(self.config.ai)
        ci_analyzer = CompetitiveAnalyzer(ai_client)

        for competitor in ci_config.competitors:
            if not competitor.enabled:
                continue

            self.console.print(f"   Classifying signals for: {competitor.name}")

            # Match items to this competitor using the competitor"s source config
            comp_items = self._match_items_to_competitor(all_items, competitor)

            if not comp_items:
                self.console.print(f"      No matching items found.")
                continue

            # AI classification for each item
            classified = []
            for item in comp_items:
                classified_item = await ci_analyzer.classify_item(item, competitor)
                if classified_item.metadata.get("ci_competitive_score", 0) > 0:
                    classified.append(classified_item)

            if classified:
                classified_items[competitor.slug] = classified
                self.console.print(f"      {len(classified)} signals detected")

        if not classified_items:
            self.console.print("   No competitive signals detected in this period.")
            return

        # Generate CI briefing
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        briefing = await ci_analyzer.generate_briefing(
            classified_items, ci_config.competitors, today, period="24h"
        )

        # Save CI report
        self.storage.save_ci_report(briefing, date=today)
        self.console.print(f"\n\U0001f4ca CI briefing saved to: data/ci-reports/ci-briefing-{today}.md")

        # Also print summary to console
        lines = briefing.split("\n")
        summary_lines = [l for l in lines if l.strip() and not l.startswith("#") and not l.startswith("---")]
        if summary_lines:
            short_summary = "\n".join(summary_lines[:10])
            self.console.print(f"\n[bold]CI Briefing Preview:[/bold]\n{short_summary}")

    def _match_items_to_competitor(
        self, items: List[ContentItem], competitor
    ) -> List[ContentItem]:
        """Match content items to a competitor based on source config.

        Args:
            items: All content items
            competitor: CompetitorConfig instance

        Returns:
            List of matching ContentItem instances
        """
        matched = []
        sources = competitor.sources

        for item in items:
            meta = item.metadata

            # RSS match
            if item.source_type == SourceType.RSS:
                feed_name = meta.get("feed_name", "")
                for rss_url in sources.rss:
                    if rss_url and (rss_url.lower() in str(item.url).lower() or rss_url.lower() in feed_name.lower()):
                        matched.append(item)
                        break

            # GitHub match
            elif item.source_type == SourceType.GITHUB:
                repo = meta.get("repo", "")
                owner = meta.get("owner", "")
                for gh_repo in sources.github_repos:
                    if gh_repo and (gh_repo.lower() == f"{owner}/{repo}".lower() or gh_repo.lower() in repo.lower()):
                        matched.append(item)
                        break
                for gh_user in sources.github_users:
                    if gh_user and gh_user.lower() == meta.get("username", "").lower():
                        matched.append(item)
                        break

            # Reddit match
            elif item.source_type == SourceType.REDDIT:
                subreddit = meta.get("subreddit", "")
                reddit_user = item.author or ""
                for rs in sources.reddit_subreddits:
                    if rs and rs.lower() == subreddit.lower():
                        matched.append(item)
                        break
                for ru in sources.reddit_users:
                    if ru and ru.lower() == reddit_user.lower():
                        matched.append(item)
                        break

            # Twitter match
            elif item.source_type == SourceType.TWITTER:
                for tu in sources.twitter_users:
                    if tu and tu.lower() == (item.author or "").lower():
                        matched.append(item)
                        break

            # Telegram match
            elif item.source_type == SourceType.TELEGRAM:
                channel = meta.get("channel", "")
                for tc in sources.telegram_channels:
                    if tc and tc.lower() == channel.lower():
                        matched.append(item)
                        break

            # Product Hunt match
            elif item.source_type == SourceType.PRODUCTHUNT:
                ph_slug = sources.producthunt_slug
                if ph_slug and ph_slug.lower() in str(item.url).lower():
                    matched.append(item)

            # Google News match
            elif item.source_type == SourceType.GOOGLENEWS:
                keyword = meta.get("keyword", "")
                for nk in sources.news_keywords:
                    if nk and nk.lower() == keyword.lower():
                        matched.append(item)
                        break

            # Web change match
            elif item.source_type == SourceType.WEB_CHANGE:
                comp_slug = meta.get("competitor_slug", "")
                if comp_slug and comp_slug == competitor.slug:
                    matched.append(item)

            # General match: look for competitor name/slug in content
            else:
                content_text = f"{item.title} {item.content or ''}".lower()
                if competitor.name.lower() in content_text or competitor.slug.lower() in content_text:
                    matched.append(item)

        return matched

    async def fetch_all_sources(self, since: datetime) -> List[ContentItem]:
        """Fetch content from all configured sources concurrently.

        Args:
            since: Only fetch items published after this time

        Returns:
            List[ContentItem]: All fetched content items
        """
        all_items: List[ContentItem] = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            tasks = []
            source_labels = []

            # Existing sources
            if self.config.sources.github:
                gh_scraper = GitHubScraper(self.config.sources.github, client)
                tasks.append(gh_scraper.fetch(since))
                source_labels.append("GitHub")

            if self.config.sources.hackernews and self.config.sources.hackernews.enabled:
                hn_scraper = HackerNewsScraper(self.config.sources.hackernews, client)
                tasks.append(hn_scraper.fetch(since))
                source_labels.append("Hacker News")

            if self.config.sources.rss:
                rss_scraper = RSSScraper(self.config.sources.rss, client)
                tasks.append(rss_scraper.fetch(since))
                source_labels.append("RSS Feeds")

            if self.config.sources.reddit and self.config.sources.reddit.enabled:
                reddit_scraper = RedditScraper(self.config.sources.reddit, client)
                tasks.append(reddit_scraper.fetch(since))
                source_labels.append("Reddit")

            if self.config.sources.telegram and self.config.sources.telegram.enabled:
                tg_scraper = TelegramScraper(self.config.sources.telegram, client)
                tasks.append(tg_scraper.fetch(since))
                source_labels.append("Telegram")

            if self.config.sources.twitter and self.config.sources.twitter.enabled:
                tw_scraper = TwitterScraper(self.config.sources.twitter, client)
                tasks.append(tw_scraper.fetch(since))
                source_labels.append("Twitter")

            if self.config.sources.openbb and self.config.sources.openbb.enabled:
                obb_scraper = OpenBBScraper(self.config.sources.openbb, client)
                tasks.append(obb_scraper.fetch(since))
                source_labels.append("OpenBB")

            if self.config.sources.ossinsight and self.config.sources.ossinsight.enabled:
                oss_scraper = OSSInsightScraper(self.config.sources.ossinsight, client)
                tasks.append(oss_scraper.fetch(since))
                source_labels.append("OSS Insight")

            # ========== NEW CI SOURCES ==========
            # Product Hunt
            ci = self.config.competitive_intelligence
            if ci and ci.enabled:
                # Product Hunt (from CI config)
                ph_config = {
                    "enabled": ci.producthunt.enabled,
                    "topics": ci.producthunt.topics,
                    "companies": ci.producthunt.companies,
                    "fetch_top_daily": ci.producthunt.fetch_top_daily,
                }
                if ph_config["enabled"]:
                    ph_scraper = ProductHuntScraper(ph_config, client)
                    tasks.append(ph_scraper.fetch(since))
                    source_labels.append("Product Hunt")

                # Google News
                gn_config = {
                    "enabled": ci.googlenews.enabled,
                    "keywords": ci.googlenews.keywords,
                    "max_items_per_keyword": ci.googlenews.max_items_per_keyword,
                    "language": ci.googlenews.language,
                    "region": ci.googlenews.region,
                }
                if gn_config["enabled"]:
                    gn_scraper = GoogleNewsScraper(gn_config, client)
                    tasks.append(gn_scraper.fetch(since))
                    source_labels.append("Google News")

                # Web Change Monitor (needs competitor configs for web pages)
                wc_config = {
                    "web_monitoring": {
                        "enabled": ci.web_monitoring.enabled,
                        "targets": [
                            t.model_dump() for t in ci.web_monitoring.targets
                        ] if ci.web_monitoring.targets else [],
                    },
                    "competitors": [
                        c.model_dump() for c in ci.competitors
                    ] if ci.competitors else [],
                }
                if ci.web_monitoring.enabled or any(c.sources.web_pages for c in ci.competitors if c.enabled):
                    wc_scraper = WebChangeScraper(wc_config, client)
                    tasks.append(wc_scraper.fetch(since))
                    source_labels.append("Web Change Monitor")

            # Fetch from sources that were added by the regular config too
            if self.config.sources.producthunt and self.config.sources.producthunt.enabled:
                ph_config = {
                    "enabled": True,
                    "topics": self.config.sources.producthunt.topics,
                    "companies": self.config.sources.producthunt.companies,
                    "fetch_top_daily": self.config.sources.producthunt.fetch_top_daily,
                }
                ph_scraper = ProductHuntScraper(ph_config, client)
                tasks.append(ph_scraper.fetch(since))
                source_labels.append("Product Hunt (standalone)")

            if self.config.sources.googlenews and self.config.sources.googlenews.enabled:
                gn_config = {
                    "enabled": True,
                    "keywords": self.config.sources.googlenews.keywords,
                    "max_items_per_keyword": self.config.sources.googlenews.max_items_per_keyword,
                    "language": self.config.sources.googlenews.language,
                    "region": self.config.sources.googlenews.region,
                }
                gn_scraper = GoogleNewsScraper(gn_config, client)
                tasks.append(gn_scraper.fetch(since))
                source_labels.append("Google News (standalone)")

            # Run all fetchers concurrently
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for label, result in zip(source_labels, results):
                    if isinstance(result, Exception):
                        self.console.print(f"   [red]\u274c Error fetching from {label}: {result}[/red]")
                    elif result:
                        all_items.extend(result)
                        # Per-source count display
                        source_counts: Dict[str, int] = defaultdict(int)
                        for item in result:
                            key = self._subsource_key(item)
                            source_counts[key] += 1
                        if source_counts:
                            detail = ", ".join(f"{k}: {v}" for k, v in sorted(source_counts.items()))
                            self.console.print(f"   Found {len(result)} items from {label}")
                            self.console.print(f"      \u2022 {detail}")
                    else:
                        self.console.print(f"   Found 0 items from {label}")

        return all_items

    async def _analyze_content(self, items: List[ContentItem]) -> List[ContentItem]:
        """Analyze content items with AI.

        Args:
            items: Items to analyze

        Returns:
            List[ContentItem]: Analyzed items
        """
        self.console.print("\U0001f916 Analyzing content with AI...")

        ai_client = create_ai_client(self.config.ai)
        analyzer = ContentAnalyzer(ai_client)

        return await analyzer.analyze_batch(items)

    async def _enrich_important_items(self, items: List[ContentItem]) -> None:
        """Enrich items with background knowledge (2nd AI pass).

        Args:
            items: Important items to enrich (modified in-place)
        """
        if not items:
            return

        self.console.print("\U0001f4ce Enriching with background knowledge...")
        ai_client = create_ai_client(self.config.ai)
        enricher = ContentEnricher(ai_client)
        await enricher.enrich_batch(items)
        self.console.print(f"   Enriched {len(items)} items\n")

    async def _generate_summary(
        self,
        items: List[ContentItem],
        date: str,
        total_fetched: int,
        language: str = "en",
    ) -> str:
        """Generate daily summary.

        Args:
            items: Important items to include (already enriched with background/related)
            date: Date string
            total_fetched: Total items fetched
            language: Output language ("en" or "zh")

        Returns:
            str: Markdown summary
        """
        self.console.print("\U0001f4d1 Generating daily summary...")

        summarizer = DailySummarizer()

        return await summarizer.generate_summary(items, date, total_fetched, language=language)

    async def merge_topic_duplicates(self, items: List[ContentItem]) -> List[ContentItem]:
        """Merge items covering the same topic, keeping the highest-scored one.

        Args:
            items: Items to deduplicate

        Returns:
            List[ContentItem]: Deduplicated items
        """
        if len(items) < 2:
            return items

        self.console.print("\U0001f9f7 Checking for topic duplicates...")

        ai_client = create_ai_client(self.config.ai)
        from .ai.prompts import TOPIC_DEDUP_SYSTEM, TOPIC_DEDUP_USER

        item_summaries = []
        for i, item in enumerate(items):
            summary = item.ai_summary or item.content or ""
            item_summaries.append(f"[{i}] Score {item.ai_score}/10: {item.title}\n    Summary: {summary[:200]}")

        items_text = "\n\n".join(item_summaries)
        user_msg = TOPIC_DEDUP_USER.format(items=items_text)

        try:
            response = await ai_client.chat(
                system=TOPIC_DEDUP_SYSTEM,
                message=user_msg,
                max_tokens=1024,
            )

            import json, re
            json_match = re.search(r"```(?:json)?\s*\n?({.*?})\n?```", response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group(1))
            elif response.strip().startswith("{"):
                result = json.loads(response.strip())
            else:
                result = {"duplicates": []}

            dup_groups = result.get("duplicates", [])
            drop_indices = set()

            for group in dup_groups:
                if not isinstance(group, list) or len(group) < 2:
                    continue
                primary_idx = group[0]
                if primary_idx < 0 or primary_idx >= len(items):
                    continue
                primary = items[primary_idx]
                for dup_idx in group[1:]:
                    if not isinstance(dup_idx, int) or dup_idx < 0 or dup_idx >= len(items):
                        continue
                    if dup_idx == primary_idx:
                        continue
                    dup = items[dup_idx]
                    if dup.content:
                        if not primary.content or dup.content not in primary.content:
                            label = dup.source_type.value
                            primary.content = (primary.content or "") + f"\n\n--- From {label} ---\n{dup.content}"
                    self.console.print(
                        f"   [dim]dedup: keep [{primary_idx}] {primary.title}[/dim]\n"
                        f"   [dim]       drop [{dup_idx}] {dup.title}[/dim]"
                    )
                    drop_indices.add(dup_idx)

            return [item for i, item in enumerate(items) if i not in drop_indices]

        except Exception as e:
            self.console.print(f"   [yellow]Topic dedup failed: {e}[/yellow]")
            return items

    async def _expand_twitter_discussion(self, items: List[ContentItem]) -> None:
        """Second-stage: fetch reply text for important Twitter items and re-analyze."""
        tw_cfg = self.config.sources.twitter
        if not tw_cfg or not tw_cfg.enabled or not tw_cfg.fetch_reply_text:
            return

        twitter_items = [
            item for item in items
            if item.source_type == SourceType.TWITTER
        ][:tw_cfg.max_tweets_to_expand]

        if not twitter_items:
            return

        self.console.print(
            f"\U0001f4b0 Fetching reply text for {len(twitter_items)} Twitter items..."
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            scraper = TwitterScraper(tw_cfg, client)
            expanded = []
            for item in twitter_items:
                try:
                    reply_lines = await scraper.fetch_replies_for_item(item)
                    if TwitterScraper.append_discussion_content(item, reply_lines):
                        expanded.append(item)
                        self.console.print(
                            f"   \U0001f4b0 {len(reply_lines)} replies added to: {item.title[:60]}"
                        )
                except Exception as exc:
                    self.console.print(
                        f"   [yellow]\u23f3 Reply fetch failed for {item.id}: {exc}[/yellow]"
                    )

        if not expanded:
            return

        self.console.print(
            f"   Re-analyzing {len(expanded)} Twitter items with reply context...\n"
        )
        ai_client = create_ai_client(self.config.ai)
        analyzer = ContentAnalyzer(ai_client)
        await analyzer.analyze_batch(expanded)

    def _determine_time_window(self, force_hours: int = None) -> datetime:
        """Determine the time window for fetching content.

        Args:
            force_hours: Optional override for time window in hours

        Returns:
            datetime: Start time for fetching
        """
        hours = force_hours or self.config.filtering.time_window_hours
        return datetime.now(timezone.utc) - timedelta(hours=hours)

    @staticmethod
    def merge_cross_source_duplicates(items: List[ContentItem]) -> List[ContentItem]:
        """Merge items that link to the same URL across sources.

        Args:
            items: All fetched items

        Returns:
            List[ContentItem]: Deduplicated items
        """
        seen_urls: Dict[str, ContentItem] = {}
        merged = []

        for item in items:
            url = str(item.url).rstrip("/")
            if url in seen_urls:
                primary = seen_urls[url]
                if item.content and (not primary.content or item.content not in primary.content):
                    label = item.source_type.value
                    primary.content = (primary.content or "") + f"\n\n--- From {label} ---\n{item.content}"
            else:
                seen_urls[url] = item
                merged.append(item)

        return merged
