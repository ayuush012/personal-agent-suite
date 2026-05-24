from __future__ import annotations

import argparse
from pathlib import Path

from agents.common import ROOT, output_dir
from .exporter import export_csv, export_json
from .jira_client import create_tickets_if_configured
from .ticket_generator import generate_tickets


def main() -> None:
    parser = argparse.ArgumentParser(description="Jarvis requirements-to-ticket agent")
    parser.add_argument("--input", default="", help="Path to requirements text/markdown")
    parser.add_argument("--export", choices=["csv", "json"], default="csv")
    parser.add_argument("--demo", action="store_true", help="Run against sanitized sample requirements")
    args = parser.parse_args()

    input_path = Path(args.input) if args.input else ROOT / "samples" / "requirements" / "password_reset.md"
    if args.demo or not args.input:
        input_path = ROOT / "samples" / "requirements" / "password_reset.md"

    requirements = input_path.read_text(encoding="utf-8")
    tickets = generate_tickets(requirements)
    out = output_dir() / f"jarvis_tickets.{args.export}"
    if args.export == "csv":
        export_csv(tickets, out)
    else:
        export_json(tickets, out)

    jira_result = create_tickets_if_configured([ticket.to_dict() for ticket in tickets])

    print("Jarvis generated tickets")
    print(f"Input: {input_path}")
    print(f"Tickets: {len(tickets)}")
    for ticket in tickets:
        print(f"- [{ticket.issue_type}] {ticket.summary}")
    print(f"\nExported: {out}")
    print(f"Jira: {jira_result['message']}")


if __name__ == "__main__":
    main()

