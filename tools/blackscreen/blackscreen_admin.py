#!/usr/bin/env python3
"""UnderWeb Cinema (Project Blackscreen) - staff catalog tool. Runs on YOUR computer, never in the world.

Needs two environment variables (never commit them, never put them in Unity):
  SUPABASE_URL                https://pxipclkptxpqukefwexh.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   the service role key (Supabase > Project Settings > API)

  python blackscreen_admin.py list
  python blackscreen_admin.py add-listing "Title" --year 1978 --category Horror --synopsis "..." [--tv]
  python blackscreen_admin.py add-episode PARENT_ID --season 1 --episode 3 "Episode title" [--year ..]
  python blackscreen_admin.py set-media ID https://direct-link.mp4 --rights public_domain --note "Internet Archive item xyz"
  python blackscreen_admin.py check ID          (asks the server to test the file right now)
  python blackscreen_admin.py remove-media ID   (back to a metadata-only listing)
  python blackscreen_admin.py hide ID / show ID

Rights (required before anything can play): public_domain, creative_commons, owned_original, licensed, creator_permission.
Only add media you actually have the right to show to a public world. The world never sees the file link: it plays
/blackscreen/s/<slot>, which only redirects while the entry is authorized AND passed its last check (within 7 days).
"""
import argparse, json, os, sys, urllib.request, urllib.error

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RIGHTS = ["public_domain", "creative_commons", "owned_original", "licensed", "creator_permission"]


def rest(method, path, body=None, prefer=None):
    if not URL or not KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (see the top of this file).")
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("apikey", KEY); req.add_header("Authorization", f"Bearer {KEY}"); req.add_header("Content-Type", "application/json")
    if prefer: req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase said {e.code}: {e.read().decode()[:400]}")


def fn(path):
    with urllib.request.urlopen(f"{URL}/functions/v1/blackscreen/{path}", timeout=60) as r:
        return r.read().decode()


def free_slot():
    used = {r["slot"] for r in rest("GET", "cinema_titles?select=slot&slot=not.is.null")}
    for s in range(0, 1000):
        if s not in used: return s
    sys.exit("All 1000 slots are used.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    a = sub.add_parser("add-listing"); a.add_argument("title"); a.add_argument("--year", type=int); a.add_argument("--category", default="Other")
    a.add_argument("--synopsis", default=""); a.add_argument("--runtime", type=int); a.add_argument("--tv", action="store_true")
    e = sub.add_parser("add-episode"); e.add_argument("parent", type=int); e.add_argument("title"); e.add_argument("--season", type=int, required=True)
    e.add_argument("--episode", type=int, required=True); e.add_argument("--year", type=int); e.add_argument("--synopsis", default=""); e.add_argument("--runtime", type=int)
    m = sub.add_parser("set-media"); m.add_argument("id", type=int); m.add_argument("url"); m.add_argument("--rights", choices=RIGHTS, required=True)
    m.add_argument("--note", required=True, help="where the rights come from, e.g. 'Internet Archive item xyz, public domain'")
    for c in ("check", "remove-media", "hide", "show"):
        sub.add_parser(c).add_argument("id", type=int)
    a = ap.parse_args()

    if a.cmd == "list":
        rows = rest("GET", "cinema_titles?select=id,kind,parent_id,title,year,slot,rights_basis,verified_ok,verified_at,verify_note,active&order=id")
        for r in rows:
            st = "INFO" if not r["slot"] and r["slot"] != 0 else ("OK  " if r["verified_ok"] else "FAIL")
            print(f'{r["id"]:>4} {r["kind"]:<7} {st} slot={r["slot"] if r["slot"] is not None else "-":<4} {"" if r["active"] else "[hidden] "}{r["title"]} ({r["year"] or "?"}) {r["rights_basis"] or ""} {r["verify_note"]}')
    elif a.cmd == "add-listing":
        r = rest("POST", "cinema_titles", {"kind": "tv" if a.tv else "movie", "title": a.title, "year": a.year, "category": a.category,
                                           "synopsis": a.synopsis, "runtime_min": a.runtime}, "return=representation")
        print("Added listing", r[0]["id"], "(metadata only - it shows as INFO ONLY until media is set)")
    elif a.cmd == "add-episode":
        r = rest("POST", "cinema_titles", {"kind": "episode", "parent_id": a.parent, "season": a.season, "episode": a.episode, "title": a.title,
                                           "year": a.year, "synopsis": a.synopsis, "runtime_min": a.runtime}, "return=representation")
        print("Added episode", r[0]["id"])
    elif a.cmd == "set-media":
        if not a.url.startswith("https://"): sys.exit("Use an https:// direct link to the video file (.mp4) or an .m3u8 stream.")
        row = rest("GET", f"cinema_titles?select=slot&id=eq.{a.id}")
        if not row: sys.exit("No such title.")
        slot = row[0]["slot"] if row[0]["slot"] is not None else free_slot()
        rest("PATCH", f"cinema_titles?id=eq.{a.id}", {"slot": slot, "file_url": a.url, "rights_basis": a.rights, "rights_note": a.note,
                                                      "verified_ok": False, "verified_at": None, "verify_note": ""})
        print(f"Set media on {a.id} (slot {slot}). Checking it now...")
        print(fn(f"check/{a.id}"))
    elif a.cmd == "check":
        print(fn(f"check/{a.id}"))
    elif a.cmd == "remove-media":
        rest("PATCH", f"cinema_titles?id=eq.{a.id}", {"slot": None, "file_url": None, "rights_basis": None, "rights_note": "", "verified_ok": False, "verified_at": None})
        print("Now a metadata-only listing.")
    elif a.cmd in ("hide", "show"):
        rest("PATCH", f"cinema_titles?id=eq.{a.id}", {"active": a.cmd == "show"}); print("Done.")


if __name__ == "__main__":
    main()
