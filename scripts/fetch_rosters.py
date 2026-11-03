"""Download every MLB team's 40-man roster from the public MLB Stats API.

Writes data/mlb_rosters.json (all teams with their players) and
data/mlb_players.csv (one row per player, easy to open in a spreadsheet).

Usage: python3 scripts/fetch_rosters.py [--season 2026]
"""

import argparse
import csv
import json
import urllib.request
from datetime import date
from pathlib import Path

API = "https://statsapi.mlb.com/api/v1"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def get(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=30) as resp:
        return json.load(resp)


def player_record(entry, team):
    p = entry["person"]
    pos = entry.get("position") or p.get("primaryPosition") or {}
    return {
        "id": p["id"],
        "name": p.get("fullName"),
        "firstName": p.get("useName") or p.get("firstName"),
        "lastName": p.get("useLastName") or p.get("lastName"),
        "jersey": entry.get("jerseyNumber") or p.get("primaryNumber"),
        "position": pos.get("abbreviation"),
        "positionType": pos.get("type"),
        "bats": (p.get("batSide") or {}).get("code"),
        "throws": (p.get("pitchHand") or {}).get("code"),
        "age": p.get("currentAge"),
        "birthDate": p.get("birthDate"),
        "birthCountry": p.get("birthCountry"),
        "height": p.get("height"),
        "weight": p.get("weight"),
        "mlbDebut": p.get("mlbDebutDate"),
        "status": (entry.get("status") or {}).get("description"),
        "teamId": team["id"],
        "team": team["name"],
        "teamAbbr": team["abbreviation"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=date.today().year)
    args = parser.parse_args()

    teams = get(f"/teams?sportId=1&season={args.season}")["teams"]
    teams.sort(key=lambda t: t["name"])

    out_teams, all_players = [], []
    for t in teams:
        team = {
            "id": t["id"],
            "name": t["name"],
            "abbreviation": t["abbreviation"],
            "league": t["league"]["name"],
            "division": t["division"]["name"],
        }
        roster = get(f"/teams/{t['id']}/roster?rosterType=40Man&season={args.season}&hydrate=person")["roster"]
        players = [player_record(e, team) for e in roster]
        players.sort(key=lambda p: (p["positionType"] != "Pitcher", p["lastName"] or ""))
        out_teams.append({**team, "players": players})
        all_players.extend(players)
        print(f"{team['abbreviation']:4} {team['name']:28} {len(players):3} players")

    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "mlb_rosters.json").write_text(json.dumps(
        {"season": args.season, "rosterType": "40Man", "fetched": date.today().isoformat(), "teams": out_teams},
        indent=2,
    ))
    with open(DATA_DIR / "mlb_players.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(all_players[0].keys()))
        writer.writeheader()
        writer.writerows(all_players)

    print(f"\n{len(out_teams)} teams, {len(all_players)} players -> {DATA_DIR}")


if __name__ == "__main__":
    main()
