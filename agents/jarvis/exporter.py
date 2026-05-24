from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Iterable

from .ticket_generator import Ticket


def export_json(tickets: Iterable[Ticket], path: Path) -> Path:
    data = [ticket.to_dict() for ticket in tickets]
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def export_csv(tickets: Iterable[Ticket], path: Path) -> Path:
    rows = [ticket.to_dict() for ticket in tickets]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "issue_type",
                "summary",
                "description",
                "acceptance_criteria",
                "priority",
                "labels",
                "story_points",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow({
                **row,
                "acceptance_criteria": "\n".join(row["acceptance_criteria"]),
                "labels": ",".join(row["labels"]),
            })
    return path

