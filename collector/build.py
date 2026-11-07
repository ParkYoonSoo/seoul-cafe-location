"""카페·베이커리 상권 분석 데이터 파이프라인 (표준 라이브러리만 사용).

사용법:  python3 collector/build.py
  1) 서울 열린데이터광장 API 수집 → data/raw/*.json (필터링된 스냅샷, 있으면 재사용)
  2) 성장 동인 3×3 계산, 백테스트(2022Q4 → 2025Q4), 예측(2025Q4 → 2028Q4)
  3) site/data.js 생성 (브라우저에서 file:// 로 바로 열 수 있도록 JS 변수로 저장)

같은 raw 스냅샷이면 항상 같은 결과가 나온다 (무작위 요소 없음).
"""
import json, math, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

KEY = os.environ.get("SEOUL_API_KEY", "")   # data/raw 캐시가 없을 때만 필요 (서울 열린데이터광장 인증키)
BASE = f"http://openapi.seoul.go.kr:8088/{KEY}/json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "site", "data.js")

YEARS = [2021, 2022, 2023, 2024, 2025]
QS = [f"{y}4" for y in YEARS]            # 매년 4분기로 통일 (계절성 제거)
T_TRAIN, P_TRAIN, Y_TRAIN = "20224", "20214", "20254"   # 백테스트: 2022 시점 동인 → 2025 실제 성장
T_PRED, P_PRED = "20254", "20244"                         # 예측: 2025 시점 동인 → 2028
INDUSTRIES = {"CS100010": "coffee", "CS100005": "bakery"}
# 통계청 소비자물가지수(2020=100) 연평균. 2025는 근사치.
CPI = {2021: 102.50, 2022: 107.72, 2023: 111.59, 2024: 114.18, 2025: 116.5}


# ───────────────────────── 수집 ─────────────────────────
def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def fetch_all(service, extra="", keep=None, cols=None):
    """페이지(1000행)를 병렬로 받아 keep(row) 통과 행만, cols 열만 남긴다."""
    tag = f"{service}_{extra.strip('/') or 'all'}".replace("/", "_")
    path = os.path.join(RAW, tag + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)["rows"]
    if not KEY:
        sys.exit(f"data/raw/{tag}.json 캐시가 없습니다. SEOUL_API_KEY 환경변수에 인증키를 넣고 다시 실행하세요.")
    first = get(f"{BASE}/{service}/1/1/{extra}")
    if service not in first:
        print(f"  ! {tag}: {first.get('RESULT')}")
        rows = []
    else:
        total = first[service]["list_total_count"]
        starts = list(range(1, total + 1, 1000))

        def page(s):
            d = get(f"{BASE}/{service}/{s}/{min(s + 999, total)}/{extra}")
            out = []
            for r in d.get(service, {}).get("row", []):
                if keep and not keep(r):
                    continue
                out.append({k: r.get(k) for k in cols} if cols else r)
            return out

        with ThreadPoolExecutor(6) as ex:
            rows = [r for chunk in ex.map(page, starts) for r in chunk]
        print(f"  {tag}: {total} → {len(rows)} rows")
    os.makedirs(RAW, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"service": service, "param": extra, "collected": date.today().isoformat(), "rows": rows}, f, ensure_ascii=False)
    return rows


SELNG_COLS = ["STDR_YYQU_CD", "TRDAR_CD", "SVC_INDUTY_CD", "THSMON_SELNG_AMT", "THSMON_SELNG_CO",
              "MDWK_SELNG_AMT", "WKEND_SELNG_AMT", "ML_SELNG_AMT", "FML_SELNG_AMT"] + \
    [f"TMZON_{t}_SELNG_AMT" for t in ["00_06", "06_11", "11_14", "14_17", "17_21", "21_24"]] + \
    [f"AGRDE_{a}_SELNG_AMT" for a in ["10", "20", "30", "40", "50", "60_ABOVE"]]
STOR_COLS = ["STDR_YYQU_CD", "TRDAR_CD", "SVC_INDUTY_CD", "STOR_CO", "SIMILR_INDUTY_STOR_CO",
             "FRC_STOR_CO", "OPBIZ_RT", "CLSBIZ_RT"]
FLPOP_COLS = ["STDR_YYQU_CD", "TRDAR_CD", "TOT_FLPOP_CO", "AGRDE_20_FLPOP_CO", "AGRDE_30_FLPOP_CO"]
SHOP_COLS = ["BPLCNM", "UPTAENM", "TRDSTATEGBN", "APVPERMYMD", "DCBYMD", "X", "Y", "SITEWHLADDR", "RDNWHLADDR"]


def collect():
    ind = lambda r: r.get("SVC_INDUTY_CD") in INDUSTRIES
    q4 = lambda r: str(r.get("STDR_YYQU_CD")) in QS
    d = {}
    d["relm"] = fetch_all("TbgisTrdarRelm")
    d["selng"] = [r for q in QS for r in fetch_all("VwsmTrdarSelngQq", q, ind, SELNG_COLS)]
    d["stor"] = [r for q in QS for r in fetch_all("VwsmTrdarStorQq", q, ind, STOR_COLS)]
    d["flpop"] = [r for q in QS for r in fetch_all("VwsmTrdarFlpopQq", q, None, FLPOP_COLS)]
    # 직장·상주인구 API는 분기 파라미터가 무시되어 전체가 내려온다 → 4분기만 남김
    d["wrc"] = fetch_all("VwsmTrdarWrcPopltnQq", "", q4, ["STDR_YYQU_CD", "TRDAR_CD", "TOT_WRC_POPLTN_CO"])
    d["repop"] = fetch_all("VwsmTrdarRepopQq", "", q4, ["STDR_YYQU_CD", "TRDAR_CD", "TOT_REPOP_CO"])
    d["ix"] = fetch_all("VwsmTrdarIxQq", T_PRED, None, ["TRDAR_CD", "TRDAR_CHNGE_IX", "TRDAR_CHNGE_IX_NM", "OPR_SALE_MT_AVRG", "CLS_SALE_MT_AVRG"])
    d["station"] = fetch_all("subwayStationMaster")
    d["subway"] = {}
    for y in YEARS:
        for m in (10, 11, 12):
            ym = f"{y}{m:02d}"
            d["subway"][ym] = fetch_all("CardSubwayTime", ym, None,
                                        ["USE_MM", "SBWY_ROUT_LN_NM", "STTN"] +
                                        [f"HR_{h}_GET_{io}_NOPE" for h in range(4, 24) for io in ("ON", "OFF")] +
                                        ["HR_0_GET_ON_NOPE", "HR_0_GET_OFF_NOPE"])
    # 인허가: 휴게음식점(커피숍 등) + 제과점영업. 현재 영업 중 + 최근 폐업만 보관.
    def shop_keep(r):
        st = r.get("TRDSTATEGBN")
        if st == "01":
            return True
        return st == "03" and (r.get("DCBYMD") or "").strip()[:4] >= "2024"
    cafe_word = re.compile(r"커피|카페|cafe|coffee|스타벅스|투썸|이디야|메가|컴포즈|빽다방|할리스|폴바셋|커피빈|파스쿠찌|더벤티|매머드|탐앤탐스|엔제리너스", re.I)

    def cafe_like(r):
        if not shop_keep(r):
            return False
        uptae = (r.get("UPTAENM") or "").strip()
        return uptae in ("커피숍", "다방", "전통찻집") or bool(cafe_word.search(r.get("BPLCNM") or ""))
    d["shop_cafe"] = fetch_all("LOCALDATA_072405", "", cafe_like, SHOP_COLS)
    d["shop_bakery"] = fetch_all("LOCALDATA_072218", "", shop_keep, SHOP_COLS)
    return d


# ───────────────────────── 좌표 변환 (TM → WGS84) ─────────────────────────
ELL = {"bessel": (6377397.155, 1 / 299.1528128), "grs80": (6378137.0, 1 / 298.257222101)}
WGS84 = (6378137.0, 1 / 298.257223563)
TOWGS84 = (-115.80, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43)   # KGD(Bessel) → WGS84
PROJ = {  # name: (ellipsoid, lon0, FE, FN)
    "EPSG:5181": ("grs80", 127.0, 200000, 500000),
    "EPSG:2097": ("bessel", 127.0, 200000, 500000),
    "EPSG:5174": ("bessel", 127.0028902777778, 200000, 500000),
}


def _merid(phi, a, e2):
    e4, e6 = e2 * e2, e2 ** 3
    return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))


def tm_inverse(x, y, proj):
    ell, lon0, FE, FN = PROJ[proj]
    a, f = ELL[ell]
    e2 = 2 * f - f * f
    ep2 = e2 / (1 - e2)
    M = _merid(math.radians(38), a, e2) + (y - FN)
    mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    C1, T1 = ep2 * c * c, t * t
    N1 = a / math.sqrt(1 - e2 * s * s)
    R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5
    D = (x - FE) / N1
    lat = p1 - (N1 * t / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
                                + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720)
    lon = math.radians(lon0) + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / c
    if ell == "bessel":
        return bessel_to_wgs84(lat, lon)
    return math.degrees(lat), math.degrees(lon)


def bessel_to_wgs84(lat, lon):
    a, f = ELL["bessel"]
    e2 = 2 * f - f * f
    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    X, Y, Z = N * math.cos(lat) * math.cos(lon), N * math.cos(lat) * math.sin(lon), N * (1 - e2) * math.sin(lat)
    tx, ty, tz, rx, ry, rz, ds = TOWGS84
    rx, ry, rz = (math.radians(v / 3600) for v in (rx, ry, rz))
    k = 1 + ds * 1e-6
    X2 = tx + k * (X - rz * Y + ry * Z)
    Y2 = ty + k * (rz * X + Y - rx * Z)
    Z2 = tz + k * (-ry * X + rx * Y + Z)
    a2, f2 = WGS84
    e22 = 2 * f2 - f2 * f2
    p = math.hypot(X2, Y2)
    la = math.atan2(Z2, p * (1 - e22))
    for _ in range(6):
        N2 = a2 / math.sqrt(1 - e22 * math.sin(la) ** 2)
        la = math.atan2(Z2 + e22 * N2 * math.sin(la), p)
    return math.degrees(la), math.degrees(math.atan2(Y2, X2))


def dist_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def norm_station(n):
    n = re.sub(r"\(.*?\)", "", str(n)).strip()
    return n[:-1] if n.endswith("역") and len(n) > 2 else n


def pick_projection(points_by_proj_fn, anchors, label):
    """역 이름이 들어간 점(상권명 '○○역', 점포명 '○○역점')과 실제 역 좌표 사이 거리 중앙값이 가장 작은 좌표계를 고른다."""
    best = None
    for proj in PROJ:
        ds = []
        for (x, y), st in anchors:
            ds.append(dist_m(tm_inverse(x, y, proj), st))
        ds.sort()
        med = ds[len(ds) // 2] if ds else 1e9
        print(f"  [{label}] {proj}: 기준점 {len(ds)}개, 역까지 거리 중앙값 {med:.0f}m")
        if best is None or med < best[1]:
            best = (proj, med, len(ds))
    return best


# ───────────────────────── 통계 유틸 ─────────────────────────
def mean(v):
    return sum(v) / len(v) if v else 0.0


def zscores(vals):
    ok = [v for v in vals if v is not None]
    m = mean(ok)
    sd = math.sqrt(mean([(v - m) ** 2 for v in ok])) or 1.0
    return [0.0 if v is None else max(-3, min(3, (v - m) / sd)) for v in vals]


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    ma, mb = mean(ra), mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def ridge(X, y, lam=5.0):
    p = len(X[0])
    my = mean(y)
    A = [[sum(r[i] * r[j] for r in X) + (lam if i == j else 0) for j in range(p)] for i in range(p)]
    b = [sum(r[i] * (yy - my) for r, yy in zip(X, y)) for i in range(p)]
    for c in range(p):  # 가우스 소거
        piv = max(range(c, p), key=lambda r: abs(A[r][c]))
        A[c], A[piv], b[c], b[piv] = A[piv], A[c], b[piv], b[c]
        for r in range(p):
            if r != c and A[c][c]:
                fct = A[r][c] / A[c][c]
                A[r] = [x - fct * y_ for x, y_ in zip(A[r], A[c])]
                b[r] -= fct * b[c]
    return my, [b[i] / A[i][i] for i in range(p)]


def pct(v, q):
    s = sorted(v)
    return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))]


def median(v):
    return pct(v, 0.5)


# ───────────────────────── 분석 ─────────────────────────
# 동인 3×3 중 데이터로 측정 가능한 지표. (그룹, 키, 설명)
FEATURES = [
    ("D_lvl", "lvl_flpop", "유동인구(로그)"),
    ("D_lvl", "lvl_wrc", "직장인구(로그)"),
    ("D_lvl", "lvl_repop", "상주인구(로그)"),
    ("D_lvl", "lvl_sub", "반경 500m 지하철 승하차(로그)"),
    ("D_trd", "trd_flpop", "유동인구 증가율"),
    ("D_trd", "trd_wrc", "직장인구 증가율"),
    ("D_trd", "trd_young", "20·30대 유동 비중 변화(%p)"),
    ("D_trd", "trd_sales", "업종 총매출 증가율(실질)"),
    ("S_lvl", "lvl_perstore", "점포당 실질 매출(로그)"),
    ("S_lvl", "lvl_density", "유동 1만 명당 점포 수(로그)"),
    ("S_lvl", "lvl_frc", "프랜차이즈 점포 비중"),
    ("S_trd", "trd_stores", "점포 수 증가율"),
    ("S_trd", "trd_net", "개업률 − 폐업률(%p)"),
    ("S_cat", "cat_frc", "프랜차이즈 점포 순증(개)"),
]


def lg(v):
    return math.log(v) if v and v > 0 else None


def growth(a, b):
    return math.log(b / a) if a and b and a > 0 and b > 0 else None


def build(d):
    print("▶ 좌표계 판별")
    stations = []
    for r in d["station"]:
        try:
            stations.append({"n": norm_station(r["BLDN_NM"]), "line": r["ROUTE"], "lat": float(r["LAT"]), "lng": float(r["LOT"])})
        except (ValueError, TypeError):
            pass
    st_by_name = {}
    for s in stations:
        st_by_name.setdefault(s["n"], (s["lat"], s["lng"]))

    anchors = []
    for r in d["relm"]:
        m = re.match(r"^(.+?)역", r["TRDAR_CD_NM"] or "")
        if m and norm_station(m.group(1)) in st_by_name:
            anchors.append(((float(r["XCNTS_VALUE"]), float(r["YDNTS_VALUE"])), st_by_name[norm_station(m.group(1))]))
    relm_proj = pick_projection(None, anchors, "상권 중심좌표")

    shop_anchor = []
    for r in d["shop_cafe"] + d["shop_bakery"]:
        m = re.search(r"([가-힣]{2,})역점", r.get("BPLCNM") or "")
        try:
            xy = (float(r["X"]), float(r["Y"]))
        except (ValueError, TypeError):
            continue
        if m and norm_station(m.group(1)) in st_by_name:
            shop_anchor.append((xy, st_by_name[norm_station(m.group(1))]))
    shop_proj = pick_projection(None, shop_anchor[:3000], "인허가 점포좌표")

    print("▶ 상권 기본정보")
    areas = {}
    for r in d["relm"]:
        lat, lng = tm_inverse(float(r["XCNTS_VALUE"]), float(r["YDNTS_VALUE"]), relm_proj[0])
        areas[r["TRDAR_CD"]] = {"c": r["TRDAR_CD"], "n": r["TRDAR_CD_NM"], "t": r["TRDAR_SE_CD_NM"], "g": r["SIGNGU_CD_NM"],
                                "d": r["ADSTRD_CD_NM"], "lat": round(lat, 6), "lng": round(lng, 6), "ar": float(r["RELM_AR"] or 0)}

    # 지하철: 4분기 3개월 합계 (승차+하차), 오전(6~11시) 비중
    print("▶ 지하철 승하차 → 상권 반경 500m 배정")
    sub = {}   # (year, station) -> riders
    unmatched = set()
    for ym, rows in d["subway"].items():
        y = int(ym[:4])
        for r in rows:
            n = norm_station(r["STTN"])
            tot = sum(float(v or 0) for k, v in r.items() if k.startswith("HR_"))
            sub[(y, n)] = sub.get((y, n), 0) + tot
            if n not in st_by_name:
                unmatched.add(n)
    all_st = {n for (_, n) in sub}
    print(f"  역 이름 매칭: {len(all_st) - len(unmatched)}/{len(all_st)} (미매칭 {len(unmatched)})")
    area_st = {}
    for c, a in areas.items():
        area_st[c] = [n for n, ll in st_by_name.items() if dist_m((a["lat"], a["lng"]), ll) <= 500]

    def sub_riders(c, y):
        v = sum(sub.get((y, n), 0) for n in area_st[c])
        return v if area_st[c] else 0.0

    # 인덱싱
    def idx(rows, val):
        out = {}
        for r in rows:
            out[(str(r["STDR_YYQU_CD"]), r["TRDAR_CD"])] = val(r)
        return out

    flpop = idx(d["flpop"], lambda r: (float(r["TOT_FLPOP_CO"] or 0), float(r["AGRDE_20_FLPOP_CO"] or 0) + float(r["AGRDE_30_FLPOP_CO"] or 0)))
    wrc = idx(d["wrc"], lambda r: float(r["TOT_WRC_POPLTN_CO"] or 0))
    repop = idx(d["repop"], lambda r: float(r["TOT_REPOP_CO"] or 0))
    ix = {r["TRDAR_CD"]: r for r in d["ix"]}
    selng, stor = {}, {}
    for r in d["selng"]:
        selng[(str(r["STDR_YYQU_CD"]), r["TRDAR_CD"], INDUSTRIES[r["SVC_INDUTY_CD"]])] = r
    for r in d["stor"]:
        stor[(str(r["STDR_YYQU_CD"]), r["TRDAR_CD"], INDUSTRIES[r["SVC_INDUTY_CD"]])] = r

    def ind_vals(q, c, kind):
        """업종 kind(coffee/bakery/blend)의 매출·점포 집계. blend = 두 업종 합."""
        kinds = ["coffee", "bakery"] if kind == "blend" else [kind]
        amt = cnt = stores = frc = opn = cls = 0.0
        prof = None
        got = False
        for k in kinds:
            s, t = selng.get((q, c, k)), stor.get((q, c, k))
            if s:
                got = True
                amt += float(s["THSMON_SELNG_AMT"] or 0)
                cnt += float(s["THSMON_SELNG_CO"] or 0)
                p = [float(s[f"TMZON_{t_}_SELNG_AMT"] or 0) for t_ in ["00_06", "06_11", "11_14", "14_17", "17_21", "21_24"]] + \
                    [float(s["MDWK_SELNG_AMT"] or 0), float(s["WKEND_SELNG_AMT"] or 0), float(s["ML_SELNG_AMT"] or 0), float(s["FML_SELNG_AMT"] or 0)] + \
                    [float(s[f"AGRDE_{a}_SELNG_AMT"] or 0) for a in ["10", "20", "30", "40", "50", "60_ABOVE"]]
                prof = p if prof is None else [x + y for x, y in zip(prof, p)]
            if t:
                st = float(t["STOR_CO"] or 0)
                stores += st
                frc += float(t["FRC_STOR_CO"] or 0)
                opn += float(t["OPBIZ_RT"] or 0) * st
                cls += float(t["CLSBIZ_RT"] or 0) * st
        if not got and stores == 0:
            return None
        y = int(q[:4])
        real = amt * CPI[2025] / CPI[y]
        tot_st = stores + frc   # STOR_CO는 일반점포, FRC_STOR_CO는 프랜차이즈 (서울시 정의)
        return {"amt": amt, "real": real, "cnt": cnt, "stores": tot_st, "frc": frc,
                "open": opn / stores if stores else 0, "close": cls / stores if stores else 0,
                "perstore": real / tot_st if tot_st else None, "prof": prof}

    def features(c, T, P, kind):
        a, b = ind_vals(T, c, kind), ind_vals(P, c, kind)
        fT, fP = flpop.get((T, c)), flpop.get((P, c))
        yT, yP = int(T[:4]), int(P[:4])
        if not a or not fT:
            return None
        f = {}
        f["lvl_flpop"] = lg(fT[0])
        f["lvl_wrc"] = lg(wrc.get((T, c), 0) + 1)
        f["lvl_repop"] = lg(repop.get((T, c), 0) + 1)
        f["lvl_sub"] = lg(sub_riders(c, yT) + 1)
        f["trd_flpop"] = growth(fP[0], fT[0]) if fP else None
        f["trd_wrc"] = growth(wrc.get((P, c)), wrc.get((T, c)))
        f["trd_young"] = (fT[1] / fT[0] - fP[1] / fP[0]) * 100 if fP and fT[0] and fP[0] else None
        f["trd_sales"] = growth(b["real"], a["real"]) if b else None
        f["lvl_perstore"] = lg(a["perstore"])
        f["lvl_density"] = lg(a["stores"] / fT[0] * 1e4) if a["stores"] and fT[0] else None
        f["lvl_frc"] = a["frc"] / a["stores"] if a["stores"] else None
        f["trd_stores"] = growth(b["stores"], a["stores"]) if b else None
        f["trd_net"] = a["open"] - a["close"]
        f["cat_frc"] = a["frc"] - b["frc"] if b else None
        return f

    keys = [k for _, k, _ in FEATURES]
    result = {"coef": {}, "backtest": {}}
    per_kind_pred = {}

    for kind in ["coffee", "bakery", "blend"]:
        print(f"▶ [{kind}] 백테스트 (2022Q4 동인 → 2022Q4~2025Q4 점포당 실질매출 성장)")
        rows = []
        for c in areas:
            a0, a1 = ind_vals(T_TRAIN, c, kind), ind_vals(Y_TRAIN, c, kind)
            if not a0 or not a1 or a0["stores"] < 3 or a1["stores"] < 3 or not a0["perstore"] or not a1["perstore"]:
                continue
            f = features(c, T_TRAIN, P_TRAIN, kind)
            if not f:
                continue
            rows.append((c, f, math.log(a1["perstore"] / a0["perstore"])))
        lo, hi = pct([r[2] for r in rows], 0.05), pct([r[2] for r in rows], 0.95)
        Z = list(zip(*[zscores([r[1][k] for r in rows]) for k in keys]))
        y = [min(hi, max(lo, r[2])) for r in rows]
        # 홀드아웃: 상권코드 짝/홀로 나눠 학습·검증 (결정적)
        tr = [i for i, r in enumerate(rows) if int(r[0]) % 2 == 0]
        te = [i for i, r in enumerate(rows) if int(r[0]) % 2 == 1]
        b0, beta = ridge([Z[i] for i in tr], [y[i] for i in tr])
        pred_te = [b0 + sum(bb * z for bb, z in zip(beta, Z[i])) for i in te]
        rho_oos = spearman(pred_te, [y[i] for i in te])
        # 비교 기준: 직전 1년 업종 매출 증가율만 보는 단순 모멘텀
        mom_i = keys.index("trd_sales")
        rho_mom = spearman([Z[i][mom_i] for i in te], [y[i] for i in te])
        # 전체 데이터로 재학습한 최종 계수
        b0, beta = ridge(Z, y)
        pred = [b0 + sum(bb * z for bb, z in zip(beta, Z[i])) for i in range(len(rows))]
        order = sorted(range(len(rows)), key=lambda i: -pred[i])
        top = order[:max(10, len(rows) // 10)]
        hit = sum(1 for i in top if y[i] >= pct(y, 0.7)) / len(top)
        result["coef"][kind] = {"b0": b0, "beta": dict(zip(keys, beta))}
        result["backtest"][kind] = {
            "n": len(rows), "rho_oos": round(rho_oos, 3), "rho_momentum": round(rho_mom, 3),
            "top_decile_hit": round(hit, 3), "top_decile_median": round(math.exp(median([y[i] for i in top])) - 1, 4),
            "all_median": round(math.exp(median(y)) - 1, 4),
            "resid_sd": round(math.sqrt(mean([(y[i] - pred[i]) ** 2 for i in range(len(rows))])), 4),
        }
        print("  ", result["backtest"][kind])

        # 예측용 동인 (2025Q4 기준), 같은 방식으로 표준화
        prow = []
        for c in areas:
            a = ind_vals(T_PRED, c, kind)
            if not a or a["stores"] < 1:
                continue
            f = features(c, T_PRED, P_PRED, kind)
            if f:
                prow.append((c, f))
        Zp = list(zip(*[zscores([r[1][k] for r in prow]) for k in keys]))
        per_kind_pred[kind] = {c: [round(z, 3) for z in Zp[i]] for i, (c, _) in enumerate(prow)}

    print("▶ 상권별 출력 데이터 구성")
    out_areas = []
    for c, a in areas.items():
        rec = dict(a)
        fl = flpop.get((T_PRED, c))
        rec["pop"] = {"flpop": fl[0] if fl else 0, "wrc": wrc.get((T_PRED, c), 0), "repop": repop.get((T_PRED, c), 0),
                      "sub": round(sub_riders(c, 2025)), "st": area_st[c][:4]}
        rec["flHist"] = [round(flpop.get((q, c), (0, 0))[0]) for q in QS]
        if c in ix:
            rec["ix"] = ix[c]["TRDAR_CHNGE_IX_NM"]
        rec["k"] = {}
        for kind in ["coffee", "bakery", "blend"]:
            v = ind_vals(T_PRED, c, kind)
            if not v or c not in per_kind_pred[kind]:
                continue
            hist = [ind_vals(q, c, kind) for q in QS]
            rec["k"][kind] = {
                "amt": round(v["amt"]), "cnt": round(v["cnt"]), "st": round(v["stores"]), "frc": round(v["frc"]),
                "op": round(v["open"], 2), "cl": round(v["close"], 2),
                "ps": round(v["perstore"]) if v["perstore"] else 0,
                "sh": [round(h["real"]) if h else None for h in hist],
                "sth": [round(h["stores"]) if h else None for h in hist],
                "pf": [round(x) for x in v["prof"]] if v["prof"] else None,
                "z": per_kind_pred[kind][c],
            }
        if rec["k"]:
            out_areas.append(rec)

    print("▶ 인허가 점포 → 지도용 포인트")
    shops = []
    for src, kind in ((d["shop_cafe"], "c"), (d["shop_bakery"], "b")):
        for r in src:
            try:
                x, y = float(r["X"]), float(r["Y"])
            except (ValueError, TypeError):
                continue
            lat, lng = tm_inverse(x, y, shop_proj[0])
            if not (37.4 < lat < 37.72 and 126.75 < lng < 127.2):
                continue
            opened = (r.get("APVPERMYMD") or "").strip()[:4]
            closed = (r.get("DCBYMD") or "").strip()[:7] if r.get("TRDSTATEGBN") == "03" else ""
            name = (r.get("BPLCNM") or "").replace("�", "").strip()   # 원본 인허가 데이터의 깨진 글자 제거
            shops.append([round(lat, 5), round(lng, 5), name, kind, opened, closed])

    meta = {
        "built": date.today().isoformat(), "asOf": "2025Q4", "quarters": QS,
        "train": {"drivers": T_TRAIN, "target": f"{T_TRAIN}→{Y_TRAIN}"}, "pred": {"drivers": T_PRED, "horizon": "2028Q4"},
        "cpi": CPI, "proj": {"relm": relm_proj, "shop": shop_proj},
        "counts": {"areas": len(out_areas), "shops": len(shops), "stations": len(stations), "subway_unmatched": len(unmatched)},
    }
    payload = {"meta": meta, "features": FEATURES, "coef": result["coef"], "backtest": result["backtest"],
               "areas": out_areas, "shops": shops}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일: collector/build.py 실행 결과. 직접 수정하지 마세요.\n")
        f.write("window.DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"✔ {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB), 상권 {len(out_areas)}개, 점포 {len(shops)}개")


if __name__ == "__main__":
    t = time.time()
    print("▶ 수집 (캐시가 있으면 재사용)")
    build(collect())
    print(f"총 {time.time() - t:.0f}초")
