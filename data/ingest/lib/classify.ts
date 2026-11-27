/**
 * Keyword rules for prepared Indian dishes (INDB has no category, diet or meal fields).
 * These are our own heuristics, used for browsing and search ranking only.
 */
import { seedRows } from "./seeds.ts";

type Rule = { category: string; re: RegExp };

// Order matters: first match wins. Every word also matches its plural (see `plural` below).
const RAW_CATEGORY_RULES: Rule[] = [
  { category: "Jams & preserves", re: /\b(jam|murabba|marmalade|preserve|jelly|curd filling)\b/ },
  { category: "Beverages", re: /\b(milkshake|tea|chai|coffee|juice|lassi|chaas|buttermilk|shake|smoothie|sharbat|sherbet|cooler|drink|lemonade|nimbu pani|thandai|punch|mocktail|cocoa|milk|squash|infused water|pani|kanji|canjee)\b/ },
  { category: "Soups", re: /\b(soup|rasam|shorba|broth|stock|consomme)\b/ },
  { category: "Breads", re: /\b(roti|chapati|phulka|paratha|parantha|naan|kulcha|poori|puri|bhatura|thepla|missi|rumali|bhakri|khakhra|bread|bun|toast|pav)\b/ },
  { category: "Rice dishes", re: /\b(rice|pulao|pulav|biryani|khichdi|khichri|fried rice|jeera rice|curd rice|lemon rice|bisi bele)\b/ },
  { category: "South Indian", re: /\b(idli|dosa|uttapam|uthappam|appam|vada|pesarattu|puttu|upma|pongal)\b/ },
  { category: "Dals & legumes", re: /\b(dal|daal|dhal|sambar|sambhar|rajma|chole|chana|lobia|moong|masoor|toor|arhar|urad|kadhi)\b/ },
  { category: "Egg dishes", re: /\b(egg|omelette|omelet|anda|bhurji)\b/ },
  { category: "Fish & seafood", re: /\b(fish|prawn|shrimp|crab|machli|macher|pomfret|surmai|bangda|lobster|seafood)\b/ },
  { category: "Meat & poultry", re: /\b(chicken|mutton|lamb|keema|kheema|meat|murgh|gosht|kebab|kabab|tikka|tandoori|seekh|pork|beef|gushtaba|rogan josh)\b/ },
  { category: "Sweets & desserts", re: /\b(icing|frosting|gunjia|ghujia|gujiya|flan|whip|bavarian|aspic|loaf|kheer|payasam|halwa|ladoo|laddu|burfi|barfi|jamun|rasgulla|rasmalai|jalebi|kulfi|ice.?cream|pudding|custard|cake|cheesecake|gateau|pastry|cookie|biscuit|tart|pie|mousse|souffle|sundae|sunday|kalakand|peda|mysore pak|gajar ka|shrikhand|phirni|sweet|chikki|brownie|eclair|meringue|candy|fudge|bun|putharekulu|rasbhari|kesari|dil bahar|delight)\b/ },
  { category: "Snacks", re: /\b(papdi|namak paras?|straw|manchurian|chilla|cheela|porridge|oatmeal|samosa|pakora|pakoda|bhaji|bhajji|kachori|dhokla|handvo|cutlet|tikki|chaat|bhel|sev|namkeen|chakli|mathri|sandwich|pizza|burger|roll|frankie|momos|spring roll|nuggets|fries|chips|pattice|patty|patties|puff|horn|aigrette|finger|mulik|fritter|bonda|muthia|khandvi|poha|chivda|makhana|pancake)\b/ },
  { category: "Salads & raita", re: /\b(salad|raita|kachumber|sprouts)\b/ },
  { category: "Chutneys & pickles", re: /\b(ketchup|dressing|chutney|pickle|achar|achaar|dip|sauce|thokku|podi)\b/ },
  { category: "Curries & vegetables", re: /\b(bhujia|creamed|khatta|curry|sabzi|subzi|bhaji|korma|makhani|masala|kofta|paneer|aloo|gobi|bhindi|baingan|palak|saag|methi|matar|kadai|kadhai|jalfrezi|poriyal|thoran|avial|kootu|dum|vindaloo|stew|gravy|foogath|dhansak|stuffed|bharwa|potato|tahar|baghar|tadka)\b/ },
];

/** Let every rule word also match its plural: "cookie" → "cookies", "patty" → "patties". */
const plural = (re: RegExp) => new RegExp(re.source.replace(/\)\\b$/, ")(?:e?s)?\\b"));
const CATEGORY_RULES: Rule[] = RAW_CATEGORY_RULES.map((r) => ({ ...r, re: plural(r.re) }));

const NON_VEG = /\b(egg|omelette|omelet|anda|chicken|mutton|lamb|keema|kheema|meat|murgh|gosht|fish|prawn|shrimp|crab|machli|macher|pomfret|surmai|bangda|lobster|seafood|pork|beef|bacon|ham|sausage|gushtaba|rogan josh|tuna|salmon|sardine)\b/;

const BREAKFAST = /\b(idli|dosa|uttapam|uthappam|appam|upma|poha|paratha|parantha|thepla|cheela|chilla|pesarattu|puttu|pongal|oats|porridge|dalia|cornflakes|muesli|omelette|omelet|toast|sandwich|pancake|bread|egg|bhurji|aloo puri|chai|tea|coffee)\b/;
const SNACK = /\b(samosa|pakora|pakoda|kachori|dhokla|cutlet|tikki|chaat|bhel|sev|namkeen|chakli|mathri|biscuit|cookie|cake|pastry|tea|chai|coffee|juice|shake|smoothie|lassi|fruit|sandwich|roll|momos|vada|bonda|makhana|chivda|ladoo|burfi|sweet)\b/;
const MAIN = /\b(rice|pulao|biryani|khichdi|dal|daal|sambar|rasam|rajma|chole|curry|sabzi|subzi|korma|kofta|paneer|roti|chapati|phulka|naan|kulcha|chicken|mutton|fish|prawn|raita|salad|kadhi|bhatura|puri|poori)\b/;

export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function classifyDish(name: string): string | undefined {
  const n = normalize(name);
  return CATEGORY_RULES.find((r) => r.re.test(n))?.category;
}

export function isVegDish(name: string): boolean {
  return !NON_VEG.test(normalize(name));
}

/** 0..1 relevance per meal slot (breakfast, lunch, snack, dinner), used to rank search results. */
export function mealRelevance(name: string, category?: string) {
  const n = normalize(name);
  const isBreakfast = BREAKFAST.test(n);
  const isSnack = SNACK.test(n) || category === "Snacks" || category === "Beverages" || category === "Sweets & desserts";
  const isMain = MAIN.test(n) || category === "Curries & vegetables" || category === "Dals & legumes" || category === "Rice dishes" || category === "Breads";
  return {
    breakfast: isBreakfast ? 1 : isSnack ? 0.4 : 0.1,
    lunch: isMain ? 1 : isSnack ? 0.2 : 0.3,
    snack: isSnack ? 1 : isBreakfast ? 0.4 : 0.1,
    dinner: isMain ? 1 : isSnack ? 0.1 : 0.3,
  };
}

type PatternRow = { re: RegExp; value: number };

let densityRules: PatternRow[] | undefined;
/** Density in g/ml from data/seeds/densities.csv, matched against name (and category). */
export function densityFor(name: string, category = ""): number | undefined {
  densityRules ??= seedRows("densities").map((r) => ({
    re: new RegExp(r.pattern!, "i"),
    value: Number(r.density_g_per_ml),
  }));
  const hay = `${normalize(name)} ${normalize(category)}`;
  return densityRules.find((r) => r.re.test(hay))?.value;
}

let pieceRules: { re: RegExp; unit: string; weightG: number }[] | undefined;
/** Curated whole-item weights from data/seeds/piece_weights.csv (all matches, in file order). */
export function pieceWeightsFor(name: string): { unit: string; weightG: number }[] {
  pieceRules ??= seedRows("piece_weights").map((r) => ({
    re: new RegExp(r.pattern!, "i"),
    unit: r.unit!,
    weightG: Number(r.weight_g),
  }));
  return pieceRules.filter((r) => r.re.test(name)).map(({ unit, weightG }) => ({ unit, weightG }));
}
