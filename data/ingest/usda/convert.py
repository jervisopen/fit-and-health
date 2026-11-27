"""
Convert USDA FoodData Central "SR Legacy" (April 2018, U.S. government work: public domain) into
the two files the app loads:

  apps/web/public/data/usda-sr-legacy.json.gz  ~7,700 foods, downloaded once at first-run setup
  data/seeds/staples.json                      everyday Indian staples (cooked rice, dal, egg, milk…)
                                               with Indian names and household measures; bundled

Usage (needs only the Python standard library):
  curl -L -o sr.zip https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
  python data/ingest/usda/convert.py sr.zip

Values are per 100 g. Only the nutrients the app tracks are kept (see packages/shared/src/nutrients.ts).
"""
import csv, gzip, io, json, os, sys, zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PREFIX = "FoodData_Central_sr_legacy_food_csv_2018-04/"
VERSION = "sr-legacy-2018-04"

# app nutrient key -> USDA nutrient ids (first one present wins, or summed where marked)
NUTRIENTS = {
    "energy_kcal": [1008], "protein_g": [1003], "carbs_g": [1005], "fat_g": [1004], "fibre_g": [1079],
    "sugar_g": [2000], "sat_fat_g": [1258], "trans_fat_g": [1257], "cholesterol_mg": [1253],
    "sodium_mg": [1093], "potassium_mg": [1092], "calcium_mg": [1087], "iron_mg": [1089], "magnesium_mg": [1090],
    "zinc_mg": [1095], "vit_a_ug": [1106], "vit_c_mg": [1162], "vit_d_ug": [1114], "vit_b6_mg": [1175],
    "vit_b12_ug": [1178], "folate_ug": [1177], "beta_carotene_ug": [1107],
}
OMEGA3 = ([1404, 1270], [1278, 1272])  # ALA (or 18:3 total) + EPA + DHA
OMEGA6 = [1316, 1269]                  # 18:2 n-6 (or 18:2 total)
KEYS = list(NUTRIENTS) + ["omega3_g", "omega6_g"]

SKIP_CATEGORIES = {"Quality Control Materials", "American Indian/Alaska Native Foods", "Branded Food Products Database"}
NON_VEG = {"Poultry Products", "Sausages and Luncheon Meats", "Pork Products", "Beef Products",
           "Finfish and Shellfish Products", "Lamb, Veal, and Game Products"}
VEG = {"Spices and Herbs", "Fruits and Fruit Juices", "Vegetables and Vegetable Products", "Nut and Seed Products",
       "Legumes and Legume Products", "Cereal Grains and Pasta"}

# ── Everyday Indian staples: (fdc_id, display name, aliases, veg, meal relevance B/L/S/D, measures) ──
# Measures: (name, grams per 1 unit, estimated?). USDA portions are added automatically as well.
K, P, G, C = "katori", "plate", "glass", "cup"
STAPLES = [
    (168878, "Plain rice, cooked (chawal)", ["cooked rice", "rice", "steamed rice", "boiled rice", "white rice", "chawal", "bhaat", "sadam", "plain rice"], 1, (0.2, 0.9, 0.2, 0.9), [(K, 150, 1), (P, 250, 1)]),
    (169704, "Brown rice, cooked", ["brown rice", "cooked brown rice", "brown chawal"], 1, (0.2, 0.9, 0.2, 0.9), [(K, 150, 1)]),
    (172421, "Plain dal, cooked (masoor / red lentils)", ["dal", "daal", "plain dal", "masoor dal", "red lentils", "boiled dal", "lentils cooked"], 1, (0.2, 0.9, 0.2, 0.9), [(K, 150, 1)]),
    (172437, "Toor / arhar dal, cooked (plain)", ["toor dal", "arhar dal", "tuvar dal", "pigeon peas"], 1, (0.2, 0.9, 0.2, 0.9), [(K, 150, 1)]),
    (174257, "Whole moong, boiled", ["moong", "green gram", "boiled moong", "moong dal whole"], 1, (0.4, 0.8, 0.4, 0.8), [(K, 150, 1)]),
    (173757, "Kabuli chana, boiled (chickpeas)", ["chana", "chole", "kabuli chana", "chickpeas", "boiled chana", "garbanzo"], 1, (0.3, 0.8, 0.6, 0.8), [(K, 150, 1)]),
    (175194, "Rajma, boiled (kidney beans)", ["rajma", "kidney beans", "boiled rajma"], 1, (0.1, 0.9, 0.2, 0.9), [(K, 150, 1)]),
    (169957, "Moong sprouts (raw)", ["sprouts", "moong sprouts", "ankurit moong"], 1, (0.8, 0.5, 0.8, 0.4), [(K, 100, 1)]),
    (173424, "Boiled egg (anda)", ["boiled egg", "egg", "anda", "hard boiled egg", "ubla anda"], 0, (0.9, 0.4, 0.6, 0.4), [("egg", 50, 0)]),
    (173423, "Fried egg", ["fried egg", "egg fry", "half fry", "bullseye"], 0, (0.9, 0.3, 0.4, 0.3), [("egg", 46, 0)]),
    (172185, "Omelette (plain)", ["omelette", "omelet", "egg omelette"], 0, (0.9, 0.3, 0.5, 0.4), [("2-egg omelette", 122, 1)]),
    (172187, "Scrambled egg (plain bhurji)", ["egg bhurji", "scrambled egg", "anda bhurji"], 0, (0.9, 0.3, 0.4, 0.4), [("egg", 61, 0)]),
    (171265, "Milk, whole (3.25% fat, like toned milk)", ["milk", "doodh", "toned milk", "whole milk", "cow milk"], 1, (0.9, 0.3, 0.6, 0.5), [(G, 258, 0), (C, 155, 1)]),
    (170872, "Milk, low fat (1%, like double-toned)", ["double toned milk", "low fat milk", "skimmed milk", "skim milk"], 1, (0.9, 0.3, 0.6, 0.5), [(G, 258, 0), (C, 155, 1)]),
    (171280, "Buffalo milk (full cream)", ["buffalo milk", "bhains ka doodh", "full cream milk"], 1, (0.9, 0.3, 0.6, 0.5), [(G, 258, 0), (C, 155, 1)]),
    (171284, "Curd / dahi (whole milk)", ["curd", "dahi", "yogurt", "yoghurt", "plain curd"], 1, (0.6, 0.9, 0.5, 0.8), [(K, 150, 1)]),
    (170886, "Curd / dahi (low fat)", ["low fat curd", "low fat dahi", "low fat yogurt"], 1, (0.6, 0.9, 0.5, 0.8), [(K, 150, 1)]),
    (171314, "Ghee", ["ghee", "desi ghee", "clarified butter"], 1, (0.5, 0.6, 0.3, 0.6), [("tsp", 4.3, 0), ("tbsp", 12.8, 0)]),
    (173410, "Butter (salted)", ["butter", "makhan", "amul butter"], 1, (0.8, 0.3, 0.5, 0.3), [("tsp", 4.7, 0), ("tbsp", 14.2, 0)]),
    (171025, "Cooking oil (sunflower)", ["oil", "cooking oil", "sunflower oil", "refined oil"], 1, (0.4, 0.6, 0.4, 0.6), [("tsp", 4.5, 0), ("tbsp", 13.6, 0)]),
    (169655, "Sugar (cheeni)", ["sugar", "cheeni", "white sugar"], 1, (0.7, 0.3, 0.7, 0.3), [("tsp", 4.2, 0), ("tbsp", 12.5, 0)]),
    (169640, "Honey (shahad)", ["honey", "shahad", "madhu"], 1, (0.7, 0.2, 0.5, 0.2), [("tsp", 7, 0), ("tbsp", 21, 0)]),
    (173227, "Tea, black (no milk, no sugar)", ["black tea", "tea no milk", "kali chai", "lal chai"], 1, (0.8, 0.3, 0.8, 0.2), [(C, 150, 1)]),
    (171890, "Coffee, black (no milk, no sugar)", ["black coffee", "coffee no milk"], 1, (0.8, 0.3, 0.7, 0.2), [(C, 150, 1)]),
    (170174, "Coconut water (nariyal pani)", ["coconut water", "nariyal pani", "tender coconut water"], 1, (0.4, 0.4, 0.8, 0.2), [(G, 240, 1)]),
    (173944, "Banana (kela)", ["banana", "kela"], 1, (0.8, 0.3, 0.8, 0.2), [("medium banana", 118, 0)]),
    (171688, "Apple (seb)", ["apple", "seb", "saib"], 1, (0.7, 0.3, 0.8, 0.2), [("medium apple", 182, 0)]),
    (169910, "Mango (aam)", ["mango", "aam", "ripe mango"], 1, (0.5, 0.4, 0.8, 0.3), [("medium mango", 200, 1)]),
    (169097, "Orange (santra)", ["orange", "santra", "narangi"], 1, (0.7, 0.3, 0.8, 0.2), [("medium orange", 131, 0)]),
    (169926, "Papaya (papita)", ["papaya", "papita"], 1, (0.8, 0.3, 0.8, 0.2), [(K, 145, 1)]),
    (173044, "Guava (amrood)", ["guava", "amrood", "amrud", "peru"], 1, (0.6, 0.3, 0.8, 0.2), [("guava", 55, 0)]),
    (174683, "Grapes (angoor)", ["grapes", "angoor", "angur"], 1, (0.5, 0.3, 0.8, 0.2), [(K, 150, 1)]),
    (167765, "Watermelon (tarbooz)", ["watermelon", "tarbooz", "tarbuj"], 1, (0.5, 0.4, 0.8, 0.2), [(K, 150, 1)]),
    (170440, "Boiled potato (aloo)", ["boiled potato", "aloo", "potato", "ubla aloo"], 1, (0.4, 0.7, 0.5, 0.7), [("medium potato", 150, 1)]),
    (168484, "Sweet potato, boiled (shakarkandi)", ["sweet potato", "shakarkandi", "shakarkand"], 1, (0.5, 0.5, 0.7, 0.4), [("medium sweet potato", 151, 0)]),
    (174924, "White bread", ["bread", "white bread", "bread slice", "double roti"], 1, (0.9, 0.3, 0.6, 0.2), [("slice", 25, 0)]),
    (172688, "Brown / whole-wheat bread", ["brown bread", "whole wheat bread", "atta bread"], 1, (0.9, 0.3, 0.6, 0.2), [("slice", 32, 0)]),
    (173905, "Oats porridge, cooked in water", ["oats", "oatmeal", "oats porridge", "cooked oats"], 1, (0.9, 0.2, 0.4, 0.3), [(K, 150, 1)]),
    (173806, "Roasted peanuts (moongphali)", ["peanuts", "moongphali", "mungfali", "groundnuts", "roasted peanuts"], 1, (0.3, 0.2, 0.8, 0.1), [("handful", 30, 1)]),
    (170567, "Almonds (badam)", ["almonds", "badam"], 1, (0.7, 0.2, 0.8, 0.1), [("10 almonds", 12, 1)]),
    (170162, "Cashews (kaju)", ["cashews", "cashew", "kaju"], 1, (0.4, 0.2, 0.8, 0.1), [("10 cashews", 15, 1)]),
    (170187, "Walnuts (akhrot)", ["walnuts", "walnut", "akhrot"], 1, (0.6, 0.2, 0.8, 0.1), [("5 halves", 10, 1)]),
    (171477, "Chicken breast, cooked (no oil)", ["chicken breast", "grilled chicken", "boiled chicken", "chicken"], 0, (0.2, 0.8, 0.4, 0.8), [("piece", 100, 1)]),
    (171054, "Chicken, cooked (meat only)", ["chicken meat", "cooked chicken", "chicken pieces"], 0, (0.1, 0.8, 0.3, 0.8), [(K, 120, 1)]),
    (174185, "Fish, carp (like rohu), cooked", ["fish", "rohu", "carp", "machli", "macher"], 0, (0.1, 0.8, 0.2, 0.8), [("piece", 85, 1)]),
    (168463, "Palak, boiled (spinach)", ["palak", "spinach", "boiled spinach"], 1, (0.2, 0.7, 0.2, 0.7), [(K, 150, 1)]),
    (168409, "Cucumber (kheera)", ["cucumber", "kheera", "kakdi"], 1, (0.3, 0.7, 0.6, 0.6), [("medium cucumber", 200, 1)]),
    (170457, "Tomato (tamatar)", ["tomato", "tamatar"], 1, (0.3, 0.6, 0.4, 0.6), [("medium tomato", 123, 0)]),
    (170000, "Onion (pyaaz)", ["onion", "pyaaz", "pyaj", "kanda"], 1, (0.2, 0.6, 0.4, 0.6), [("medium onion", 110, 0)]),
    (170393, "Carrot (gajar)", ["carrot", "gajar"], 1, (0.3, 0.5, 0.6, 0.5), [("medium carrot", 61, 0)]),
]


def read(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(PREFIX + name), encoding="utf-8"))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def round_sig(v):
    if v is None:
        return None
    if v == 0:
        return 0
    a = abs(v)
    return round(v, 3 if a < 1 else 2 if a < 10 else 1 if a < 100 else 0)


def main(zip_path):
    z = zipfile.ZipFile(zip_path)
    cats = {r["id"]: r["description"] for r in read(z, "food_category.csv")}
    foods = {}
    for r in read(z, "food.csv"):
        cat = cats.get(r["food_category_id"], "")
        if cat in SKIP_CATEGORIES:
            continue
        foods[int(r["fdc_id"])] = {"name": r["description"].strip(), "cat": cat, "n": {}, "portions": []}

    wanted = {i for ids in NUTRIENTS.values() for i in ids} | set(OMEGA3[0]) | set(OMEGA3[1]) | set(OMEGA6)
    for r in read(z, "food_nutrient.csv"):
        f = foods.get(int(r["fdc_id"]))
        nid = int(r["nutrient_id"])
        if f is not None and nid in wanted:
            v = num(r["amount"])
            if v is not None:
                f["n"][nid] = v

    for r in read(z, "food_portion.csv"):
        f = foods.get(int(r["fdc_id"]))
        amount, grams = num(r["amount"]), num(r["gram_weight"])
        label = (r["modifier"] or r["portion_description"] or "").strip()
        if f is None or not amount or not grams or not label:
            continue
        f["portions"].append((label, round(grams / amount, 1), int(r["seq_num"] or 99)))

    def values(n):
        out = []
        for key in NUTRIENTS:
            out.append(round_sig(next((n[i] for i in NUTRIENTS[key] if i in n), None)))
        ala = next((n[i] for i in OMEGA3[0] if i in n), None)
        o3 = None if ala is None else ala + sum(n.get(i, 0) for i in OMEGA3[1])
        out.append(round_sig(o3))
        out.append(round_sig(next((n[i] for i in OMEGA6 if i in n), None)))
        return out

    def portions(f):
        seen, out = set(), []
        for label, g, _ in sorted(f["portions"], key=lambda p: p[2]):
            if label.lower() in seen:
                continue
            seen.add(label.lower())
            out.append([label, g])
        return out[:6]

    staple_ids = {s[0] for s in STAPLES}
    cat_list = sorted({f["cat"] for f in foods.values()})
    cat_index = {c: i for i, c in enumerate(cat_list)}

    # Bulk file: everything except the staples (those ship separately, with Indian names).
    rows = []
    for fdc, f in sorted(foods.items()):
        if fdc in staple_ids or 1008 not in f["n"]:
            continue
        veg = 0 if f["cat"] in NON_VEG else 1 if f["cat"] in VEG else None
        rows.append([fdc, f["name"], cat_index[f["cat"]], veg, values(f["n"]), portions(f)])
    bulk = {"version": VERSION, "source": "USDA FoodData Central, SR Legacy (April 2018), public domain",
            "nutrients": KEYS, "categories": cat_list, "foods": rows}
    out_dir = os.path.join(ROOT, "apps", "web", "public", "data")
    os.makedirs(out_dir, exist_ok=True)
    raw = json.dumps(bulk, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with open(os.path.join(out_dir, "usda-sr-legacy.json.gz"), "wb") as fh:
        fh.write(gzip.compress(raw, compresslevel=9, mtime=0))

    staples = []
    for fdc, name, aliases, veg, rel, measures in STAPLES:
        f = foods[fdc]
        staples.append({
            "fdcId": fdc, "name": name, "usdaName": f["name"], "aliases": aliases, "isVeg": bool(veg),
            "relevance": dict(zip(["breakfast", "lunch", "snack", "dinner"], rel)),
            "measures": [{"name": m, "weightG": g, "isEstimated": bool(e)} for m, g, e in measures]
                        + [{"name": label, "weightG": g, "isEstimated": False} for label, g in portions(f)],
            "nutrients": dict(zip(KEYS, values(f["n"]))),
        })
    with open(os.path.join(ROOT, "data", "seeds", "staples.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"version": VERSION, "source": bulk["source"], "foods": staples}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"bulk: {len(rows)} foods, {len(raw) / 1e6:.1f} MB json, "
          f"{os.path.getsize(os.path.join(out_dir, 'usda-sr-legacy.json.gz')) / 1e6:.2f} MB gz; staples: {len(staples)}")


if __name__ == "__main__":
    main(sys.argv[1])
