#!/usr/bin/env python3
"""Word count for the TSP abstract: whitespace-separated tokens after removing Markdown bold markers.
Section labels ("Background:" etc.) count as one word each; this reproduces the template's recorded
count (title 15 + body 335 incl. labels = 350). Usage: count_words.py FILE  (FILE has a '## Title'
section and a '## Body' section ending at a line '---' / next '## ', or the TITLE/BODY scratch form).
Example (from wsi-viewer/): python3 -I docs/dissemination/tsp-2027/tools/count_words.py docs/dissemination/tsp-2027/abstract-v1.md"""
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
if "## Title" in t:
    title = t.split("## Title", 1)[1].split("\n## ", 1)[0].strip()
    body = t.split("## Body", 1)[1]
    body = re.split(r"\n---\n|\n## ", body, maxsplit=1)[0].strip()
else:
    title = t.split("TITLE\n", 1)[1].split("BODY\n", 1)[0].strip()
    body = t.split("BODY\n", 1)[1].strip()
w = lambda s: len(s.replace("**", "").split())
paras = [p for p in body.split("\n\n") if p.strip()]
for p in paras:
    print(f"  {p.split()[0].replace('**',''):<14} {w(p):>4} words")
print(f"title {w(title)}; body {w(body)} incl. the 4 labels ({w(body) - 4} without); title + body = {w(title) + w(body)}")
