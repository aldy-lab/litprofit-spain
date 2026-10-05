#!/usr/bin/env python3
"""
Builds index.html from tools/calc/app.html.

    python3 tools/build.py

Database mode only. The Lithuanian build also has a no-database mode that
encrypts the page per user; this copy has no use for it -- the figures live
behind Supabase Auth and row level security, never in the file.

The project URL and publishable key are written in below rather than taken
from the environment, because both are public by design: the key names the
project and grants nothing on its own. They are the Lithuanian calculator's
project, on purpose -- Iberia is a schema in it, not a project of its own.
The build refuses a secret key if one is ever pasted here by mistake.
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SUPA_URL = "https://uiuzbhekmroosmemwhdr.supabase.co"
SUPA_KEY = "sb_publishable_TqgtbKuCnl6P-kFObE5hbg_tfn0YR95"

# The page is served from the repository root on GitHub Pages
# (aldy-lab.github.io/litprofit-spain/), so asset paths are relative to it.
# Relative rather than "/litprofit-spain", so the same build works on a
# custom domain or under /iberia/ on litprofit.com without a rebuild.
BASE = "."


def main():
    if SUPA_KEY.startswith(("sb_secret_", "sbp_")) or "service_role" in SUPA_KEY:
        sys.exit("That is a secret key. It bypasses row level security and this\n"
                 "file is published. Use the publishable key (sb_publishable_...).")
    src = io.open(os.path.join(ROOT, "tools", "calc", "app.html"), encoding="utf-8").read()
    for ph in ("__BASE__", "__SUPABASE_URL__", "__SUPABASE_ANON_KEY__"):
        if ph not in src:
            sys.exit("placeholder %s is missing from app.html" % ph)
    out = (src.replace("__BASE__", BASE)
              .replace("__SUPABASE_URL__", SUPA_URL)
              .replace("__SUPABASE_ANON_KEY__", SUPA_KEY))
    dest = os.path.join(ROOT, "index.html")
    io.open(dest, "w", encoding="utf-8").write(out)
    print("written     index.html  %d bytes" % len(out.encode("utf-8")))
    print("project     %s  (schema: iberia)" % SUPA_URL)


if __name__ == "__main__":
    main()
