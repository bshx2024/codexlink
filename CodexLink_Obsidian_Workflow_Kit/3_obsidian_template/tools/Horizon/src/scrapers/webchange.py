"""Web page change monitor scraper for competitor website tracking."""

import logging
import hashlib
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from bs4 import BeautifulSoup

from .base import BaseScraper
from ..models import ContentItem, SourceType

logger = logging.getLogger(__name__)


class WebChangeScraper(BaseScraper):
    """Scraper that monitors web pages for content changes.

    This scraper takes a snapshot of configured web pages and stores
    content hashes. On subsequent runs, it detects content changes
    and emits ContentItems when meaningful changes are found.
    """

    # In-memory cache of previous content hashes (per run)
    # In production, this would use a persistent store
    _previous_hashes: dict = {}

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)
        self.web_monitor_config = config.get("web_monitoring", {})
        self.competitor_configs = config.get("competitors", [])

    async def fetch(self, since: datetime) -> List[ContentItem]:
        items = []

        # Fetch from explicit web_monitoring targets
        targets = self.web_monitor_config.get("targets", []) if isinstance(self.web_monitor_config, dict) else []
        for target in targets:
            if not target.get("enabled", True):
                continue
            item = await self._check_page(target, since)
            if item:
                items.append(item)

        # Also check competitor-specific web pages
        for comp in self.competitor_configs:
            comp_slug = comp.get("slug", "")
            comp_name = comp.get("name", comp_slug)
            sources = comp.get("sources", {})
            web_pages = sources.get("web_pages", []) if isinstance(sources, dict) else []

            for page_url in web_pages:
                target = {
                    "url": page_url,
                    "name": f"{comp_name}",
                    "keywords": [],
                    "selector": "",
                }
                item = await self._check_page(target, since, competitor_slug=comp_slug)
                if item:
                    items.append(item)

        return items

    async def _check_page(
        self, target: dict, since: datetime, competitor_slug: str = ""
    ) -> Optional[ContentItem]:
        """Check a single web page for changes."""
        url = str(target.get("url", ""))
        name = target.get("name", url)
        selector = target.get("selector", "")
        keywords = target.get("keywords", [])

        if not url:
            return None

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        try:
            response = await self.client.get(url, headers=headers, follow_redirects=True, timeout=20.0)
            response.raise_for_status()

            html = response.text
            soup = BeautifulSoup(html, "html.parser")

            # Remove scripts, styles, nav, footer for cleaner diff
            for tag in soup(["script", "style", "nav", "footer", "noscript"]):
                tag.decompose()

            # If a CSS selector is specified, scope to that element
            if selector:
                selected = soup.select_one(selector)
                if selected:
                    text_content = selected.get_text(separator="\n", strip=True)
                else:
                    text_content = soup.get_text(separator="\n", strip=True)
            else:
                text_content = soup.get_text(separator="\n", strip=True)

            # Remove excessive whitespace
            import re
            text_content = re.sub(r"\n{3,}", "\n\n", text_content)
            text_content = text_content[:10000]  # Limit to 10k chars

            # Compute content hash
            content_hash = hashlib.sha256(text_content.encode("utf-8")).hexdigest()
            cache_key = f"webchange:{url}"

            prev_hash = WebChangeScraper._previous_hashes.get(cache_key)

            # Detect title change
            title_tag = soup.title
            page_title = title_tag.get_text(strip=True) if title_tag else name

            # If we have a previous hash and it changed, emit an item
            if prev_hash and prev_hash != content_hash:
                # Try to summarize what changed
                change_desc = self._detect_section_changes(soup, url)
                full_content = page_title
                if change_desc:
                    full_content += f"\n\nDetected changes: {change_desc}"
                full_content += f"\n\n--- Page snapshot ---\n{text_content[:3000]}"

                item = ContentItem(
                    id=self._generate_id("web_change", "page", hashlib.sha256(url.encode()).hexdigest()[:16]),
                    source_type=SourceType.WEB_CHANGE,
                    title=f"页面变更: {page_title}" if competitor_slug else f"Page Change: {page_title}",
                    url=url,
                    content=full_content,
                    published_at=datetime.now(timezone.utc),
                    metadata={
                        "page_url": url,
                        "page_title": page_title,
                        "change_type": "content_update",
                        "competitor_slug": competitor_slug if competitor_slug else None,
                    },
                )
                WebChangeScraper._previous_hashes[cache_key] = content_hash
                logger.info("Change detected on %s: %s", url, page_title)
                return item

            # First time seeing this page - store hash, no item yet
            WebChangeScraper._previous_hashes[cache_key] = content_hash

            # If keywords are specified, scan for them on first pass too
            if keywords:
                matched = [kw for kw in keywords if kw.lower() in text_content.lower()]
                if matched:
                    item = ContentItem(
                        id=self._generate_id("web_change", "keyword", hashlib.sha256(f"{url}:{','.join(keywords)}".encode()).hexdigest()[:16]),
                        source_type=SourceType.WEB_CHANGE,
                        title=f"关键词命中: {', '.join(matched[:3])}" if competitor_slug else f"Keyword Match: {', '.join(matched[:3])}",
                        url=url,
                        content=f"Page: {page_title}\nURL: {url}\n\nMatched keywords: {', '.join(matched)}\n\nContext:\n{text_content[:2000]}",
                        published_at=datetime.now(timezone.utc),
                        metadata={
                            "page_url": url,
                            "page_title": page_title,
                            "change_type": "keyword_match",
                            "matched_keywords": matched,
                            "competitor_slug": competitor_slug if competitor_slug else None,
                        },
                    )
                    return item

        except httpx.TimeoutException:
            logger.warning("Timeout fetching %s", url)
        except httpx.HTTPError as e:
            logger.warning("HTTP error fetching %s: %s", url, e)
        except Exception as e:
            logger.warning("Error monitoring %s: %s", url, e)

        return None

    def _detect_section_changes(self, soup, url: str) -> str:
        """Try to identify what section of the page changed."""
        # Look for common pricing/product page sections
        sections = {}

        # Pricing
        pricing_el = soup.find(string=lambda t: t and "pricing" in t.lower())
        if not pricing_el:
            pricing_el = soup.find(class_=lambda c: c and "pricing" in c.lower()) if hasattr(soup, 'find') else None

        # Features
        features = soup.find(string=lambda t: t and ("feature" in t.lower() or "what's new" in t.lower()))

        changes = []
        if pricing_el:
            changes.append("pricing section")
        if features:
            changes.append("features section")

        return "; ".join(changes) if changes else "general content update"
