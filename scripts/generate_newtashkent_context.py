import json
import math
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reports" / "newtashkent-kmz-data.json"
OUTPUT = ROOT / "public" / "newtashkent-context.json"

MAP_CENTER = [69.485184, 41.295214]
MAP_ZOOM = 14
MAPS = {
    "twoD": "https://www.newtashkent.uz/en/maps/lod-map-two",
    "threeD": "https://www.newtashkent.uz/en/maps/lod-map-three",
    "threeDFrame": "https://yangitoshkent360.uz",
}


def geometry_rings(geometry):
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return coordinates
    return [ring for polygon in coordinates for ring in polygon]


def feature_points(feature):
    return [point for ring in geometry_rings(feature["geometry"]) for point in ring]


def centroid(feature):
    points = feature_points(feature)
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


def clean_text(value):
    if not isinstance(value, str):
        return value
    return value.replace("Ê»", "'").replace("ʻ", "'").replace("‘", "'").replace("’", "'")


def counter_items(features, key, limit=12):
    values = Counter((clean_text(feature["properties"].get(key)) or "—") for feature in features)
    return [{"name": name, "count": count} for name, count in values.most_common(limit)]


def main():
    if not SOURCE.exists():
        raise SystemExit(
            f"Source not found: {SOURCE}. Download it from https://www.newtashkent.uz/maps/kmz-data first."
        )

    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    features = data.get("features", [])
    points = [point for feature in features for point in feature_points(feature)]
    nearest = sorted(
        ((distance_meters(MAP_CENTER, centroid(feature)), feature) for feature in features),
        key=lambda item: item[0],
    )[:20]
    nearby = [compact_feature(feature, distance) for distance, feature in nearest]

    payload = {
        "source": "https://www.newtashkent.uz/maps/kmz-data",
        "sourceLocal": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "mapCenter": MAP_CENTER,
        "mapZoom": MAP_ZOOM,
        "maps": MAPS,
        "featureCount": len(features),
        "bbox": {
            "west": min(point[0] for point in points),
            "south": min(point[1] for point in points),
            "east": max(point[0] for point in points),
            "north": max(point[1] for point in points),
        },
        "topBlocks": counter_items(features, "Blok"),
        "topFunctions": counter_items(features, "Funksiya 1", 15),
        "nearMapCenter": nearby,
        "insights": [
            "The official 2D map is an ArcGIS satellite map centered near New Tashkent's core planning area.",
            "Near the official map center, the closest polygons include administrative center, city park, mixed-use residential, school, and hotel/retail functions.",
            "This context is useful for long-term area quality, but it is not precise enough to rank individual Sharq Bahori flats without exact building coordinates.",
        ],
    }

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Features summarized: {len(features)}")


if __name__ == "__main__":
    main()
