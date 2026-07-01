"""CLI entry point for Horizon."""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console

from .storage.manager import ConfigError, StorageManager
from .orchestrator import HorizonOrchestrator


console = Console()


def print_banner():
    """Print the application banner."""
    banner = r"""
[bold blue]
  _    _            _
 | |  | |          (_)
 | |__| | ___  _ __ _ ___  ___  _ __
 |  __  |/ _ \| '\''__| |_  / / _ \| '\''_ \
 | |  | | (_) | |  | |/ / | (_) | | | |
 |_|  |_|\___/|_|  |_/___| \___/|_| |_|
[/bold blue]
[cyan]  AI-Driven Information Aggregation System[/cyan]
    """
    console.print(banner)


def main():
    """Main CLI entry point."""
    print_banner()

    parser = argparse.ArgumentParser(
        description="Horizon - AI-Driven Information Aggregation System"
    )
    parser.add_argument("--hours", type=int, help="Force fetch from last N hours")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["daily", "ci"],
        default="daily",
        help='Run mode: "daily" (default) for standard summary, "ci" for competitive intelligence',
    )
    parser.add_argument(
        "--ci-only",
        action="store_true",
        help="Run only competitive intelligence pipeline",
    )
    args = parser.parse_args()

    mode = "ci" if args.ci_only else args.mode

    try:
        load_dotenv()
        data_dir = Path("data")
        storage = StorageManager(data_dir=str(data_dir))

        try:
            config = storage.load_config()
        except FileNotFoundError:
            console.print("[bold red]\u274c Configuration file not found![/bold red]\n")
            data_dir_path = data_dir if isinstance(data_dir, Path) else Path(data_dir)
            example_path = data_dir_path / "config.example.json"
            if example_path.exists():
                console.print(
                    "Copy the example config and edit it:\n"
                    f"  [cyan]cp {example_path} {data_dir_path / 'config.json'}[/cyan]\n"
                )
            console.print(
                "Or run [bold cyan]uv run horizon-wizard[/bold cyan] to launch the interactive setup wizard.\n"
            )
            sys.exit(1)
        except ConfigError as e:
            console.print(f"[bold red]\u274c Error loading configuration: {e}[/bold red]")
            sys.exit(1)
        except Exception as e:
            console.print(f"[bold red]\u274c Error loading configuration: {e}[/bold red]")
            sys.exit(1)

        if mode == "ci":
            asyncio.run(_run_ci_mode(config, storage, args.hours))
        else:
            orchestrator = HorizonOrchestrator(config, storage)
            asyncio.run(orchestrator.run(force_hours=args.hours))

    except KeyboardInterrupt:
        console.print("\n[yellow]\u23f3 Interrupted by user[/yellow]")
        sys.exit(0)
    except Exception as e:
        console.print(f"\n[bold red]\u274c Fatal error: {e}[/bold red]")
        import traceback
        traceback.print_exc()
        sys.exit(1)


async def _run_ci_mode(config, storage, force_hours=None):
    """Run CI-only mode."""
    ci = config.competitive_intelligence
    if not ci or not ci.enabled:
        console.print("[yellow]Competitive Intelligence is not enabled in config.[/yellow]")
        console.print("Set competitive_intelligence.enabled = true and add competitors.")
        return

    hours = force_hours or config.filtering.time_window_hours
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    console.print("[bold cyan]\U0001f50d Running in CI mode...[/bold cyan]\n")

    orchestrator = HorizonOrchestrator(config, storage)

    all_items = await orchestrator.fetch_all_sources(since)
    console.print(f"\U0001f4dc Fetched {len(all_items)} items\n")

    analyzed = await orchestrator._analyze_content(all_items)
    console.print(f"\U0001f916 Analyzed {len(analyzed)} items\n")

    await orchestrator._run_ci_pipeline(analyzed, since)


def print_config_template():
    """Print configuration template."""
    template = """
{
  "version": "1.0",
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4.5-20250929",
    "api_key_env": "ANTHROPIC_API_KEY",
    "temperature": 0.3,
    "max_tokens": 4096
  },
  "sources": {
    "github": [
      {
        "type": "user_events",
        "username": "torvalds",
        "enabled": true
      }
    ],
    "hackernews": {
      "enabled": true,
      "fetch_top_stories": 30,
      "min_score": 100
    },
    "rss": [
      {
        "name": "Example Blog",
        "url": "https://example.com/feed.xml",
        "enabled": true,
        "category": "software-engineering"
      }
    ]
  },
  "filtering": {
    "ai_score_threshold": 7.0,
    "time_window_hours": 24
  }
}

Also create a .env file with:
ANTHROPIC_API_KEY=your_api_key_here
GITHUB_TOKEN=your_github_token_here (optional but recommended)
"""
    console.print(template)


if __name__ == "__main__":
    main()
