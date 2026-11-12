#!/usr/bin/env python3
"""Collect OSM geography into an unpublished review candidate; never edit status."""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = "https://raw.githubusercontent.com/Vonter/bmrcl-gtfs/main/geojson/export.geojson"
RELATIONS = {"pink": 6119472, "blue": 14460571, "orange": 14720127,
             "orangewest": 14720128, "red": 14938457}
USER_AGENT = "NammaAtlas/1.0 (+https://namma-atlas-bengaluru.inzi00.chatgpt.site)"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def collect(cache, offline, explicit_date):
    urls = {"gtfs.geojson": EXPORT}
    urls.update({f"osm-{line}.json":
                 f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full.json"
                 for line, rid in RELATIONS.items()})
    manifest_path = cache / "fetch-manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {"files": {}}
    records = manifest.setdefault("files", {})
    inputs, dates = {}, {}
    for filename, url in urls.items():
        path = cache / filename
        if not offline:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=45) as response:
                body = response.read(20_000_001)
            if len(body) > 20_000_000:
                raise ValueError(f"Response exceeded 20 MB: {filename}")
            json.loads(body)  # Reject an HTML error before replacing a cached input.
            path.write_bytes(body)
            records[filename] = {"url": url,
                                 "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                                 "sha256": hashlib.sha256(body).hexdigest()}
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            print(f"Fetched {filename}")
        if not path.exists():
            raise FileNotFoundError(f"Missing cached input: {path}")
        body = path.read_bytes()
        record = records.get(filename, {})
        if offline and record.get("sha256") and hashlib.sha256(body).hexdigest() != record["sha256"]:
            raise ValueError(f"Cached input no longer matches its fetch manifest: {filename}")
        inputs[filename] = json.loads(body)
        dates[filename] = explicit_date or record.get("retrievedAt", "Unknown; cached input")
    return inputs, dates


def operational(data):
    routes, stations = [], []
    for feature in data["features"]:
        properties, geometry = feature["properties"], feature["geometry"]
        line = properties.get("ref", "").lower()
        if (geometry["type"] == "LineString" and line in {"purple", "green", "yellow"}
                and line not in {route["line"] for route in routes}):
            routes.append({"id": line, "line": line, "coordinates": geometry["coordinates"],
                           "sourceId": properties["@id"],
                           "geometryQuality": "OpenStreetMap mapped track alignment"})
        if properties.get("railway") == "station":
            memberships = list(dict.fromkeys(r["rel"].lower() for r in properties.get("@relations", [])
                                             if r.get("rel", "").lower() in {"purple", "green", "yellow"}))
            if not memberships:
                continue
            if geometry["type"] != "Point":
                raise ValueError("Expected a station point in the operating export")
            stations.append({"id": properties.get("code") or properties["@id"].replace("/", "-"),
                             "name": properties["name"], "nameKn": properties.get("name:kn"),
                             "coordinates": geometry["coordinates"], "lines": memberships,
                             "sourceId": properties["@id"], "altName": properties.get("alt_name"),
                             "wikidata": properties.get("wikidata")})
    if {route["id"] for route in routes} != {"purple", "green", "yellow"}:
        raise ValueError("Operating export no longer contains all three expected mapped lines")
    for route in routes:
        coords = route["coordinates"]
        def rank(station):
            c = station["coordinates"]
            return min(range(len(coords)), key=lambda i: (coords[i][0]-c[0])**2+(coords[i][1]-c[1])**2)
        route["stationIds"] = [station["id"] for station in sorted(
            (s for s in stations if route["id"] in s["lines"]), key=rank)]
    return routes, stations


def expansion(data, line, relation_id):
    by_id = {(element["type"], element["id"]): element for element in data["elements"]}
    relation = by_id["relation", relation_id]
    remaining = [list(by_id["way", member["ref"]]["nodes"]) for member in relation["members"]
                 if member["type"] == "way"]
    paths = []
    while remaining:
        chain = remaining.pop(0)
        while True:
            for index, way in enumerate(remaining):
                if chain[-1] == way[0]:
                    chain += way[1:]
                elif chain[-1] == way[-1]:
                    chain += way[-2::-1]
                elif chain[0] == way[-1]:
                    chain = way[:-1] + chain
                elif chain[0] == way[0]:
                    chain = way[:0:-1] + chain
                else:
                    continue
                remaining.pop(index)
                break
            else:
                break
        paths.append([[by_id["node", node]["lon"], by_id["node", node]["lat"]] for node in chain])
    if not paths:
        raise ValueError(f"No mapped ways in {line}")
    paths.sort(key=len, reverse=True)
    stations = []
    for member in relation["members"]:
        if member["type"] != "node":
            continue
        element = by_id["node", member["ref"]]
        tags = element.get("tags", {})
        stations.append({"id": tags.get("code") or f"osm-{element['id']}",
                         "name": re.sub(r"\s*\(u/c\)\s*", "", tags.get("name", "")).strip(),
                         "nameKn": tags.get("name:kn"), "coordinates": [element["lon"], element["lat"]],
                         "lines": [line], "sourceId": f"node/{element['id']}",
                         "sourceUrl": f"https://www.openstreetmap.org/node/{element['id']}",
                         "altName": tags.get("alt_name"),
                         "geometryQuality": "OpenStreetMap station position, unofficial geography"})
    route = {"id": line, "line": line, "coordinates": paths[0], "parts": paths,
             "sourceId": f"relation/{relation_id}",
             "sourceUrl": f"https://www.openstreetmap.org/relation/{relation_id}",
             "stationIds": [station["id"] for station in stations],
             "geometryQuality": "OpenStreetMap mapped alignment; not an official engineering survey",
             "notes": ["Geography only. Verify station coverage and visual section boundaries before publishing."]}
    return route, stations


def build(inputs, dates):
    routes, stations = operational(inputs["gtfs.geojson"])
    by_source = {station["sourceId"]: station for station in stations}
    for line, relation_id in RELATIONS.items():
        route, additions = expansion(inputs[f"osm-{line}.json"], line, relation_id)
        remap = {}
        for station in additions:
            source_id = station["sourceId"]
            if source_id in by_source:
                existing = by_source[source_id]
                remap[station["id"]] = existing["id"]
                existing["lines"] = list(dict.fromkeys(existing["lines"] + station["lines"]))
                existing["altName"] = existing.get("altName") or station.get("altName")
            else:
                by_source[source_id] = station
        route["stationIds"] = [remap.get(sid, sid) for sid in route["stationIds"]]
        routes.append(route)
    common = {"attribution": "© OpenStreetMap contributors",
              "attributionUrl": "https://www.openstreetmap.org/copyright",
              "license": "Open Database License (ODbL)",
              "note": "Geography only; OSM status tags are not operational evidence."}
    sources = [{**common, "id": "osm-vonter", "title": "OpenStreetMap data, exported by Vonter/bmrcl-gtfs",
                "url": "https://github.com/Vonter/bmrcl-gtfs/blob/main/geojson/export.geojson",
                "downloadUrl": EXPORT, "retrievedAt": dates["gtfs.geojson"]},
               {**common, "id": "osm-direct", "title": "OpenStreetMap Namma Metro route relations",
                "url": "https://wiki.openstreetmap.org/wiki/Namma_Metro",
                "retrievedAt": {line: dates[f"osm-{line}.json"] for line in RELATIONS}}]
    return {"stations": list(by_source.values()), "routes": routes, "sources": sources}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use existing raw inputs without fetching")
    parser.add_argument("--cache-dir", type=Path, default=ROOT/".cache/geography")
    parser.add_argument("--output", type=Path, default=ROOT/".cache/network-candidate.json")
    parser.add_argument("--retrieved-at", help="Known YYYY-MM-DD retrieval date for legacy offline inputs")
    args = parser.parse_args()
    if args.retrieved_at:
        if not args.offline:
            parser.error("--retrieved-at is only for offline inputs; live fetches record their real timestamps")
        dt.date.fromisoformat(args.retrieved_at)
    if args.output.resolve() == (ROOT/"dist/data/network.json").resolve():
        parser.error("Write a review candidate, then adopt it separately after validating display boundaries")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    inputs, dates = collect(args.cache_dir, args.offline, args.retrieved_at)
    result = build(inputs, dates)
    from validate_data import validate_network
    validate_network(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    print(f"Wrote review candidate: {args.output}")
    print(f"{len(result['routes'])} corridors; {len(result['stations'])} mapped nodes. Official status unchanged.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(f"Collection failed: {error}", file=sys.stderr)
        sys.exit(1)
