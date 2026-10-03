# -*- coding: utf-8 -*-
# Генерация PNG-иконок из icons/icon.svg через headless Edge.
# Запуск: C:/Python314/python.exe make_icons.py
import os
import subprocess
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8")

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
ROOT = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(ROOT, "icons", "icon.svg")
SIZES = [192, 512]

# Обёртка: SVG без width/height растягивается на весь body, скриншот = ровно размер окна.
HTML = """<!doctype html><html><head><style>
        html,body{{margin:0;padding:0;overflow:hidden}}
        svg{{display:block;width:100vw;height:100vh}}
      </style></head><body>{svg}</body></html>"""

with open(SVG, encoding="utf-8") as f:
    svg_text = f.read()

for size in SIZES:
    html = HTML.format(svg=svg_text)
    tmp_path = os.path.join(ROOT, f"_icon_{size}.html")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(html)

    out_png = os.path.join(ROOT, "icons", f"icon-{size}.png")
    url = "file:///" + tmp_path.replace("\\", "/")
    cmd = [
        EDGE,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--window-size={size},{size}",
        f"--screenshot={out_png}",
        url,
    ]
    subprocess.run(cmd, check=True, timeout=60)
    time.sleep(1)
    os.remove(tmp_path)
    print(f"OK {out_png} ({os.path.getsize(out_png)} байт)")

print("Готово.")