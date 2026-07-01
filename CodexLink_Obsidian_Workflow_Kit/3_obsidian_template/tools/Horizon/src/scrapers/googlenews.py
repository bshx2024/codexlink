"""Google News scraper for competitor keyword monitoring."""

import logging
import hashlib
from datetime import datetime, timezone
from typing import List
from urllib.parse import quote_plus

import httpx
import feedparser

from .base import BaseScraper
from ..models import ContentItem, SourceType

logger = logging.getLogger(__name__)


class GoogleNewsScraper(BaseScraper):
    """Scraper for Google News RSS feeds by keyword."""

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)
        self.base_url = "https://news.google.com/rss/search"

    async def fetch(self, since: datetime) -> List[ContentItem]:
        cfg = self.config
        if not cfg.get("enabled", False):
            return []

        keywords = cfg.get("keywords", [])
        max_items = cfg.get("max_items_per_keyword", 10)
        lang = cfg.get("language", "en")
        region = cfg.get("region", "US")

        if not keywords:
            return []

        all_items = []
        for keyword in keywords:
            items = await self._search_keyword(keyword, max_items, lang, region, since)
            all_items.extend(items)

        return all_items

    async def _search_keyword(
        self, keyword: str, max_items: int, lang: str, region: str, since: datetime
    ) -> List[ContentItem]:
        """Search Google News for a keyword."""
        query = quote_plus(keyword)
        url = f"{self.base_url}?q={query}&hl={lang}-{region}&gl={region}&ceid={region}:{lang}"

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
        }

        try:
            response = await self.client.get(url, headers=headers, follow_redirects=True, timeout=15.0)
            response.raise_for_status()

            feed = feedparser.parse(response.text)
            items = []
            count = 0

            for entry in feed.entries:
                if count >= max_items:
                    break

                # Parse date
                pub_date = self._parse_date(entry)
                if pub_date and pub_date < since:
                    continue

                title = entry.get("title", "Untitled")
                link = entry.get("link", "")
                source_name = entry.get("source", {}).get("title", "Google News")
                summary = entry.get("summary", "")

                # Google News links are redirect URLs; try to extract real source
                snippet = entry.get("summary_detail", {}).get("value", "")
                # Clean HTML tags from summary
                import re
                snippet = re.sub(r"<[^>]+>", "", snippet)

                content_parts = [snippet] if snippet else []
                content_parts.append(f"Source: {source_name}")

                item_id = hashlib.sha256(f"{keyword}:{link}".encode("utf-8")).hexdigest()[:16]

                item = ContentItem(
                    id=self._generate_id("googlenews", "search", item_id),
                    source_type=SourceType.GOOGLENEWS,
                    title=title,
                    url=link or f"https://news.google.com/search?q={query}",
                    content="\n".join(content_parts),
                    author=source_name,
                    published_at=pub_date or datetime.now(timezone.utc),
                    metadata={
                        "keyword": keyword,
                        "source_name": source_name,
                    },
                )
                items.append(item)
                count += 1

            return items

        except httpx.HTTPError as e:
            logger.warning("Error fetching Google News for '%s': %s", keyword, e)
            return []
        except Exception as e:
            logger.warning("Error parsing Google News for '%s': %s", keyword, e)
            return []

    def _parse_date(self, entry: dict) -> datetime:
        """Parse publication date from entry."""
        from email.utils import parsedate_to_datetime
        import calendar

        for field in ["published", "updated"]:
            if field in entry:
                try:
                    if f"{field}_parsed" in entry and entry[f"{field}_parsed"]:
                        return datetime.fromtimestamp(
                            calendar.timegm(entry[f"{field}_parsed"]), tz=timezone.utc
                        )
                    return parsedate_to_datetime(entry[field])
                except Exception:
                    continue
        return None
