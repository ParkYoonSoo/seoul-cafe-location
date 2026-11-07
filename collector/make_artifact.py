"""site/index.html(로컬용) → site/artifact.html(claude.ai 공유 페이지용) 변환.

공유 페이지는 문서 뼈대를 자동으로 씌우고 외부 스타일시트를 막으므로
<html>/<head>/<body> 태그를 걷어내고 Leaflet CSS를 인라인으로 넣는다.
"""
import os, re

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
src = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
head = src[src.index("<head>") + 6:src.index("</head>")]
body = src[src.index("<body>") + 6:src.index("</body>")]
leaflet = open(os.path.join(SITE, "vendor", "leaflet.css"), encoding="utf-8").read()
head = re.sub(r'<meta name="viewport"[^>]*>\n?', "", head)
head = head.replace('<link rel="stylesheet" href="vendor/leaflet.css">', f"<style>{leaflet}</style>")
body = body.replace('<span id="tileNote"></span>', '<span id="tileNote">공유 페이지에서는 배경 지도 대신 자치구 경계를 표시합니다</span>')
with open(os.path.join(SITE, "artifact.html"), "w", encoding="utf-8") as f:
    f.write(head.strip() + "\n" + body.strip() + "\n")
print("artifact.html", os.path.getsize(os.path.join(SITE, "artifact.html")), "bytes")
