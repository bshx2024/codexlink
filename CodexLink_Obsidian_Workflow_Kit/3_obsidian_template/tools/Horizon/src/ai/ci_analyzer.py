"""Competitive intelligence analyzer.

Performs signal classification, competitive impact scoring,
and SWOT analysis on content items for tracked competitors.
"""

import json
import logging
from typing import List, Dict, Any, Optional, Tuple

from ..models import ContentItem, SignalType, CompetitorConfig
from .prompts import CI_ANALYSIS_SYSTEM, CI_ANALYSIS_USER, CI_SWOT_SYSTEM, CI_SWOT_USER

logger = logging.getLogger(__name__)


class CompetitiveAnalyzer:
    """Analyzes content items for competitive intelligence signals."""

    def __init__(self, ai_client):
        self.ai_client = ai_client
        self.signal_types = {s.value: s for s in SignalType}

    async def classify_item(
        self,
        item: ContentItem,
        competitor: CompetitorConfig,
    ) -> ContentItem:
        """Classify a single item for competitive intelligence."""
        competitor_context = (
            f"Tracked Competitor: {competitor.name} (slug: {competitor.slug})\n"
            f"Tags: {', '.join(competitor.tags)}\n"
            f"Watching signals: {', '.join(competitor.signal_types)}"
        )

        content = item.content or ""
        content_truncated = content[:4000]

        user_msg = CI_ANALYSIS_USER.format(
            title=item.title,
            source=item.source_type.value,
            url=str(item.url),
            content=content_truncated,
            competitor_context=competitor_context,
        )

        try:
            response = await self.ai_client.complete(
                system=CI_ANALYSIS_SYSTEM,
                user=user_msg,
                max_tokens=1024,
            )

            result = self._parse_json_response(response)
            if result:
                item.metadata["ci_signal_type"] = result.get("signal_type", "general")
                item.metadata["ci_competitive_score"] = result.get("competitive_score", 0)
                item.metadata["ci_urgency"] = result.get("urgency", 1)
                item.metadata["ci_implication"] = result.get("implication", "")
                item.metadata["ci_suggested_action"] = result.get("suggested_action", "")

                # Tag the item with the competitor slug
                item.metadata["competitor_slug"] = competitor.slug
                item.metadata["competitor_name"] = competitor.name

        except Exception as e:
            logger.warning("Error classifying item %s for competitor %s: %s",
                           item.id, competitor.slug, e)

        return item

    async def generate_briefing(
        self,
        classified_items: Dict[str, List[ContentItem]],  # competitor_slug -> items
        competitors: List[CompetitorConfig],
        date: str,
        period: str = "24h",
    ) -> str:
        """Generate a competitive intelligence briefing from classified items."""
        if not classified_items:
            return "No competitive intelligence signals detected in this period."

        # Build competitor items summary
        sections = []
        for comp in competitors:
            if comp.slug not in classified_items or not classified_items[comp.slug]:
                sections.append(f"### {comp.name}\nNo signals detected.")
                continue

            comp_items = classified_items[comp.slug]
            items_text = []
            for item in comp_items:
                ci_score = item.metadata.get("ci_competitive_score", 0)
                ci_type = item.metadata.get("ci_signal_type", "general")
                ci_urgency = item.metadata.get("ci_urgency", 1)
                implication = item.metadata.get("ci_implication", "")
                items_text.append(
                    f"- [{ci_type}] (Impact: {ci_score}/10, Urgency: {ci_urgency}/5) "
                    f"{item.title} - {implication}"
                )

            sections.append(
                f"### {comp.name} ({len(comp_items)} signals)\n" +
                "\n".join(items_text)
            )

        competitor_items_text = "\n\n".join(sections)

        try:
            user_msg = CI_SWOT_USER.format(
                date=date,
                period=period,
                competitor_items=competitor_items_text,
            )

            response = await self.ai_client.complete(
                system=CI_SWOT_SYSTEM,
                user=user_msg,
                max_tokens=2048,
            )

            result = self._parse_json_response(response)
            if result:
                return self._format_briefing(result, classified_items, competitors)
        except Exception as e:
            logger.warning("Error generating CI briefing: %s", e)

        return "Briefing generation failed."

    def _format_briefing(
        self,
        result: dict,
        classified_items: Dict[str, List[ContentItem]],
        competitors: List[CompetitorConfig],
    ) -> str:
        """Format the AI briefing into Markdown."""
        lines = [
            "# \U0001f3e2 Competitor Intelligence Briefing\n",
        ]

        if result.get("executive_summary"):
            lines.append(f"> **Executive Summary**: {result['executive_summary']}\n")

        # Key Developments
        if result.get("key_developments"):
            lines.append("## \U0001f4cc Key Developments\n")
            for dev in result["key_developments"]:
                stars = "\u2b50" * min(5, max(1, dev.get("importance", 5) // 2))
                lines.append(f"- {stars} **{dev['competitor']}**: {dev['signal']}")
            lines.append("")

        # Threats
        if result.get("threats"):
            lines.append("## \u26a0\ufe0f Threats\n")
            for threat in result["threats"]:
                sev = threat.get("severity", 0)
                icon = "\U0001f534" if sev >= 8 else "\U0001f7e1" if sev >= 5 else "\U0001f7e2"
                lines.append(f"- {icon} **{threat['competitor']}**: {threat['threat']}")
            lines.append("")

        # Opportunities
        if result.get("opportunities"):
            lines.append("## \U0001f4a1 Opportunities\n")
            for opp in result["opportunities"]:
                src = opp.get("source_competitor", "")
                lines.append(f"- **{src}**: {opp['opportunity']}")
            lines.append("")

        # Recommendations
        if result.get("recommendations"):
            lines.append("## \U0001f3af Recommendations\n")
            priority_icon = {"high": "\U0001f534", "medium": "\U0001f7e1", "low": "\U0001f7e2"}
            for rec in result["recommendations"]:
                pri = rec.get("priority", "medium")
                icon = priority_icon.get(pri, "\U0001f7e1")
                lines.append(f"- {icon} **[{pri.upper()}]** {rec['action']}")
                if rec.get("rationale"):
                    lines.append(f"  - *{rec['rationale']}*")
            lines.append("")

        # Signal details
        lines.append("## \U0001f4e1 Raw Signals\n")
        for comp in competitors:
            if comp.slug not in classified_items or not classified_items[comp.slug]:
                continue
            lines.append(f"### {comp.name}\n")
            for item in classified_items[comp.slug]:
                signal_type = item.metadata.get("ci_signal_type", "general")
                score = item.metadata.get("ci_competitive_score", "?")
                urgency = item.metadata.get("ci_urgency", "?")
                implication = item.metadata.get("ci_implication", "")
                lines.append(
                    f"- [{signal_type}] \u2b50{score}/10 \U0001f6a8{urgency}/5\n"
                    f"  [{item.title}]({item.url})\n"
                    f"  _{implication}_"
                )
            lines.append("")

        return "\n".join(lines)

    def _parse_json_response(self, response: str) -> Optional[dict]:
        """Parse JSON from AI response."""
        response = response.strip()

        if response.startswith("{"):
            try:
                return json.loads(response)
            except json.JSONDecodeError:
                pass

        import re
        json_match = re.search(r"```(?:json)?\s*\n?({.*?})\n?```", response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        json_match = re.search(r"({.*})", response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        logger.warning("Failed to parse AI response as JSON: %s", response[:200])
        return None
