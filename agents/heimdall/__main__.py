from __future__ import annotations

import argparse
from .router import AGENTS, route_request


def main() -> None:
    parser = argparse.ArgumentParser(description="Heimdall request router")
    parser.add_argument("--request", default="", help="Request to route")
    parser.add_argument("--demo", action="store_true", help="Run a sanitized demo request")
    args = parser.parse_args()

    request = args.request
    if args.demo or not request:
        request = "Turn this password reset feature brief into Jira-ready tickets."

    decision = route_request(request)
    print("Heimdall routing decision")
    print(f"Request: {request}")
    print(f"Route: {decision.agent}")
    print(f"Confidence: {decision.confidence}")
    print(f"Reason: {decision.reason}")
    print("\nAvailable agents:")
    for agent, description in AGENTS.items():
        print(f"- {agent}: {description}")


if __name__ == "__main__":
    main()

