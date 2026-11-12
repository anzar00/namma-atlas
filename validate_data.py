#!/usr/bin/env python3
"""Validate the atlas's geography and evidence references, without network calls."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {"purple", "green", "yellow", "pink", "blue", "orange", "orange-west", "red"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalize(line):
    return "orange-west" if line == "orangewest" else line


def coordinate(point):
    require(len(point) == 2 and all(isinstance(x, (float, int)) and math.isfinite(x) for x in point),
            f"Invalid coordinate: {point}")
    require(77 < point[0] < 78 and 12 < point[1] < 14, f"Coordinate outside Bengaluru region: {point}")


def validate_network(network):
    stations = network["stations"]
    ids = {station["id"] for station in stations}
    require(len(ids) == len(stations), "Duplicate station IDs")
    require(len({s["sourceId"] for s in stations}) == len(stations), "Duplicate OSM source nodes")
    require({normalize(r["id"]) for r in network["routes"]} == EXPECTED, "Unexpected corridor coverage")
    require(len(network["routes"]) == len(EXPECTED), "Duplicate corridors")
    by_id = {s["id"]: s for s in stations}
    for station in stations:
        coordinate(station["coordinates"])
        require(bool(station["name"]), f"Missing name: {station['id']}")
        require(bool(station["lines"]) and set(map(normalize, station["lines"])) <= EXPECTED,
                f"Unknown line membership: {station['id']}")
    for route in network["routes"]:
        require(len(route["coordinates"]) >= 2, f"Empty route: {route['id']}")
        for part in route.get("parts", [route["coordinates"]]):
            require(len(part) >= 2, f"Empty route part: {route['id']}")
            for point in part:
                coordinate(point)
        require(set(route["stationIds"]) <= ids, f"Unresolved station reference: {route['id']}")
        for sid in route["stationIds"]:
            require(normalize(route["id"]) in map(normalize, by_id[sid]["lines"]),
                    f"Station membership mismatch: {sid}")
    require(bool(network["sources"]) and all(s.get("url") and s.get("license") and s.get("attribution")
                                            for s in network["sources"]), "Missing geography provenance")


def validate_status(status):
    dt.datetime.fromisoformat(status["checkedAt"])
    require({line["id"] for line in status["lines"]} == EXPECTED, "Status corridor mismatch")
    sources = {source["id"] for source in status["sources"]}
    require(len(sources) == len(status["sources"]), "Duplicate evidence IDs")
    for source in status["sources"]:
        require(source["url"].startswith("https://") and source["authority"] and source["published"],
                f"Incomplete evidence record: {source['id']}")
    for line in status["lines"]:
        require(line["status"] in {"operational", "construction", "proposed"}, "Unknown corridor status")
        require(line["sourceIds"] and set(line["sourceIds"]) <= sources, f"Missing evidence: {line['id']}")
        if "progress" in line:
            progress = line["progress"]
            require(0 <= progress["value"] <= 100 and progress.get("asOf") and progress.get("scope")
                    and progress.get("sourceId") in sources, f"Unscoped progress: {line['id']}")
        for section in line.get("sections", []):
            require(section["sourceId"] in sources, f"Missing section evidence: {line['id']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", type=Path, default=ROOT/"dist/data/network.json")
    parser.add_argument("--status", type=Path, default=ROOT/"dist/data/status.json")
    args = parser.parse_args()
    network = json.loads(args.network.read_text(encoding="utf-8"))
    status = json.loads(args.status.read_text(encoding="utf-8"))
    validate_network(network)
    validate_status(status)
    operating = sum(any(normalize(l) in {"purple", "green", "yellow"} for l in s["lines"])
                    for s in network["stations"])
    print(f"Valid: {len(network['routes'])} corridors, {len(network['stations'])} mapped nodes, "
          f"{operating} nodes with Purple/Green/Yellow memberships; evidence references resolved.")


if __name__ == "__main__":
    main()
