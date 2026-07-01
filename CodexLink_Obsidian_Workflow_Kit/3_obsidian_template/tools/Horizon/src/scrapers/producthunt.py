"""Product Hunt scraper implementation."""

import logging
import hashlib
from datetime import datetime, timezone
from typing import List, Optional

import httpx

from .base import BaseScraper
from ..models import ContentItem, SourceType

logger = logging.getLogger(__name__)


class ProductHuntScraper(BaseScraper):
    """Scraper for Product Hunt products and launches."""

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)
        self.base_url = "https://api.producthunt.com/v2/api/graphql"
        self.token = None  # Optional: PH API token for higher rate limits

    async def fetch(self, since: datetime) -> List[ContentItem]:
        cfg = self.config
        if not cfg.get("enabled", False):
            return []

        items = []
        topics = cfg.get("topics", [])
        companies = cfg.get("companies", [])

        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        headers["Accept"] = "application/json"

        # Fetch top daily posts
        top_n = cfg.get("fetch_top_daily", 20)
        posts = await self._fetch_posts(headers, top_n)
        items.extend(posts)

        # If specific companies/topics are configured, try fetching by company slug
        for company_slug in companies:
            company_posts = await self._fetch_company_posts(company_slug, headers)
            items.extend(company_posts)

        return items

    async def _fetch_posts(self, headers: dict, limit: int = 20) -> List[ContentItem]:
        """Fetch latest/hot posts from Product Hunt."""
        query = """
        {
          posts(first: %d, order: VOTES) {
            edges {
              node {
                id
                name
                tagline
                description
                url
                website
                votesCount
                commentsCount
                createdAt
                topics(first: 5) {
                  edges { node { name slug } }
                }
                makers { edges { node { name } } }
              }
            }
          }
        }
        """ % limit

        try:
            response = await self.client.post(
                self.base_url,
                json={"query": query},
                headers=headers,
                timeout=15.0,
            )
            if response.status_code == 200:
                data = response.json()
                posts = data.get("data", {}).get("posts", {}).get("edges", [])
                return self._parse_posts(posts)
            elif response.status_code == 401:
                logger.warning("Product Hunt API requires authentication; try setting PRODUCTHUNT_TOKEN")
                return []
            else:
                logger.warning("Product Hunt API returned status %d", response.status_code)
                return []
        except httpx.TimeoutException:
            logger.warning("Product Hunt API request timed out")
            return []
        except Exception as e:
            logger.warning("Error fetching Product Hunt posts: %s", e)
            return []

    async def _fetch_company_posts(self, company_slug: str, headers: dict) -> List[ContentItem]:
        """Fetch posts for a specific company/topic."""
        query = """
        {
          posts(first: 5, topic: "%s") {
            edges {
              node {
                id
                name
                tagline
                description
                url
                website
                votesCount
                commentsCount
                createdAt
                topics(first: 5) {
                  edges { node { name slug } }
                }
              }
            }
          }
        }
        """ % company_slug

        try:
            response = await self.client.post(
                self.base_url,
                json={"query": query},
                headers=headers,
                timeout=10.0,
            )
            if response.status_code == 200:
                data = response.json()
                posts = data.get("data", {}).get("posts", {}).get("edges", [])
                return self._parse_posts(posts)
        except Exception as e:
            logger.warning("Error fetching Product Hunt for %s: %s", company_slug, e)
        return []

    def _parse_posts(self, edges: list) -> List[ContentItem]:
        items = []
        for edge in edges:
            node = edge.get("node", {})
            post_id = node.get("id", "")
            name = node.get("name", "Untitled")
            tagline = node.get("tagline", "")
            description = node.get("description", "")
            url = node.get("url", "")
            website = node.get("website", "")

            votes = node.get("votesCount", 0)
            comments = node.get("commentsCount", 0)
            created_str = node.get("createdAt", "")

            pub_date = datetime.now(timezone.utc)
            if created_str:
                try:
                    from dateutil import parser as dateparser
                    pub_date = dateparser.parse(created_str).replace(tzinfo=timezone.utc)
                except Exception:
                    pass

            topics = []
            topic_edges = node.get("topics", {}).get("edges", [])
            for te in topic_edges:
                t = te.get("node", {})
                topics.append(f"#{t.get('slug', t.get('name', ''))}")

            makers = []
            maker_edges = node.get("makers", {}).get("edges", [])
            for me in maker_edges:
                makers.append(me.get("node", {}).get("name", ""))

            content_parts = [tagline]
            if description:
                content_parts.append(description)
            if website:
                content_parts.append(f"Website: {website}")

            item = ContentItem(
                id=self._generate_id("producthunt", "post", post_id),
                source_type=SourceType.PRODUCTHUNT,
                title=name,
                url=url or f"https://www.producthunt.com/posts/{post_id}",
                content="\n\n".join(content_parts),
                author=", ".join(makers) if makers else None,
                published_at=pub_date,
                metadata={
                    "votes": votes,
                    "comments": comments,
                    "tagline": tagline,
                    "topics": topics,
                },
            )
            items.append(item)
        return items
