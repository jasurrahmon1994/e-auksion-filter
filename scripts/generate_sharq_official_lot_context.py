import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reports" / "newtashkent-kmz-data.json"
OUTPUT = ROOT / "public" / "sharq-official-lot-context.json"

YANGI_TOSHKENT_MAP_CENTER = [69.485184, 41.295214]
SHARQ_BAHORI_YANDEX_POINT = [69.457473, 41.296161]

# Yandex org page exposes broad bounds around Sharq Bahori. The project overview
# image is perspective-rendered, so these projected lot coordinates are rough.
SHARQ_BAHORI_BOUNDS = {
    "west": 69.452393,
    "south": 41.267822,
    "east": 69.504693,
    "north": 41.315248,
}

LOT_MARKERS = [
    {"id": "34A", "x": 39.5, "y": 13.3, "layout": "full"},
    {"id": "43F", "x": 36.2, "y": 65.2, "layout": "sideCenterRemoved"},
    {"id": "43D", "x": 42.7, "y": 62.9, "layout": "sideCenterRemoved"},
    {"id": "45D", "x": 50.9, "y": 58.6, "layout": "full"},
    {"id": "44B", "x": 49.3, "y": 68.6, "layout": "sideCenterRemoved"},
    {"id": "46A", "x": 57.8, "y": 65.0, "layout": "full"},
    {"id": "44A", "x": 54.6, "y": 76.7, "layout": "sideCenterRemoved"},
]


def clean_text(value):
    if not isinstance(value, str):
        return value
    return value.replace("Ê»", "'").replace("ʻ", "'").replace("‘", "'").replace("’", "'")


def rings(geometry):
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return coordinates
    return [ring for polygon in coordinates for ring in polygon]


def centroid(feature):
    points = [point for ring in rings(feature["geometry"]) for point in ring]
    return [
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    ]


def distance_meters(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    radius = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def project_marker(marker):
    bounds = SHARQ_BAHORI_BOUNDS
    lon = bounds["west"] + (bounds["east"] - bounds["west"]) * marker["x"] / 100
    lat = bounds["north"] - (bounds["north"] - bounds["south"]) * marker["y"] / 100
    return [round(lon, 6), round(lat, 6)]


def compact_feature(feature, distance):
    properties = feature["properties"]
    return {
        "distanceMeters": round(distance),
        "transekt": clean_text(properties.get("Transekt:")),
        "block": clean_text(properties.get("Blok")),
        "function1": clean_text(properties.get("Funksiya 1")),
        "function2": clean_text(properties.get("Funksiya 2")),
        "areaHa": properties.get("Yer maydoni (ga)"),
        "floors": properties.get("Qavat:"),
    }


def nearest_features(features, point, limit=8):
    nearest = sorted(
        ((distance_meters(point, centroid(feature)), feature) for feature in features),
        key=lambda item: item[0],
    )
    return [compact_feature(feature, distance) for distance, feature in nearest[:limit]]


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Source not found: {SOURCE}")

    features = json.loads(SOURCE.read_text(encoding="utf-8")).get("features", [])
    lots = []
    for marker in LOT_MARKERS:
        point = project_marker(marker)
        lots.append(
            {
                "id": marker["id"],
                "layout": marker["layout"],
                "estimatedCoordinate": point,
                "nearest": nearest_features(features, point),
            }
        )

    payload = {
        "source": "https://www.newtashkent.uz/maps/kmz-data",
        "sourceLocal": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "mapCenter": YANGI_TOSHKENT_MAP_CENTER,
        "sharqBahoriYandexPoint": SHARQ_BAHORI_YANDEX_POINT,
        "sharqBahoriBounds": SHARQ_BAHORI_BOUNDS,
        "projectionConfidence": "low",
        "projectionNote": "Lot coordinates are estimated by projecting the existing Sharq overview marker positions into the broad Yandex Sharq Bahori bounds. Use them for planning context only, not survey-grade location.",
        "sharqPointNearest": nearest_features(features, SHARQ_BAHORI_YANDEX_POINT, 10),
        "lots": lots,
    }

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Lots summarized: {len(lots)}")


if __name__ == "__main__":
    main()
