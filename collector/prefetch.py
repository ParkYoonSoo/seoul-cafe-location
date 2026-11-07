"""build.py 수집 단계 일부를 별도 프로세스로 미리 받아 캐시를 채운다 (속도용)."""
import sys, re
sys.path.insert(0, "collector")
import build as b

part = sys.argv[1]
if part == "misc":
    b.fetch_all("VwsmTrdarIxQq", b.T_PRED, None, ["TRDAR_CD", "TRDAR_CHNGE_IX", "TRDAR_CHNGE_IX_NM", "OPR_SALE_MT_AVRG", "CLS_SALE_MT_AVRG"])
    b.fetch_all("subwayStationMaster")
    for y in b.YEARS:
        for m in (10, 11, 12):
            b.fetch_all("CardSubwayTime", f"{y}{m:02d}", None,
                        ["USE_MM", "SBWY_ROUT_LN_NM", "STTN"] + [f"HR_{h}_GET_{io}_NOPE" for h in range(4, 24) for io in ("ON", "OFF")] + ["HR_0_GET_ON_NOPE", "HR_0_GET_OFF_NOPE"])
    b.fetch_all("VwsmTrdarRepopQq", "", lambda r: str(r.get("STDR_YYQU_CD")) in b.QS, ["STDR_YYQU_CD", "TRDAR_CD", "TOT_REPOP_CO"])
else:
    def shop_keep(r):
        st = r.get("TRDSTATEGBN")
        return st == "01" or (st == "03" and (r.get("DCBYMD") or "").strip()[:4] >= "2024")
    word = re.compile(r"커피|카페|cafe|coffee|스타벅스|투썸|이디야|메가|컴포즈|빽다방|할리스|폴바셋|커피빈|파스쿠찌|더벤티|매머드|탐앤탐스|엔제리너스", re.I)
    def cafe_like(r):
        return shop_keep(r) and ((r.get("UPTAENM") or "").strip() in ("커피숍", "다방", "전통찻집") or bool(word.search(r.get("BPLCNM") or "")))
    if part == "bakery":
        b.fetch_all("LOCALDATA_072218", "", shop_keep, b.SHOP_COLS)
    else:
        b.fetch_all("LOCALDATA_072405", "", cafe_like, b.SHOP_COLS)
print("done", part)
