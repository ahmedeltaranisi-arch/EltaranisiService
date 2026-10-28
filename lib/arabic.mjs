import aps from "arabic-persian-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();
const shaper = aps.ArabicShaper;

/** Presentation form (FB50–FDFF, FE70–FEFF) -> logical character sequence */
const PRESENTATION_MAP = {
  "\uFE80": "\u0621", "\uFE81": "\u0622", "\uFE82": "\u0622", "\uFE83": "\u0623", "\uFE84": "\u0623",
  "\uFE85": "\u0624", "\uFE86": "\u0624", "\uFE87": "\u0625", "\uFE88": "\u0625", "\uFE89": "\u0626",
  "\uFE8A": "\u0626", "\uFE8B": "\u0626", "\uFE8C": "\u0626", "\uFE8D": "\u0627", "\uFE8E": "\u0627",
  "\uFE8F": "\u0628", "\uFE90": "\u0628", "\uFE91": "\u0628", "\uFE92": "\u0628", "\uFE93": "\u0629",
  "\uFE94": "\u0629", "\uFE95": "\u062A", "\uFE96": "\u062A", "\uFE97": "\u062A", "\uFE98": "\u062A",
  "\uFE99": "\u062B", "\uFE9A": "\u062B", "\uFE9B": "\u062B", "\uFE9C": "\u062B", "\uFE9D": "\u062C",
  "\uFE9E": "\u062C", "\uFE9F": "\u062C", "\uFEA0": "\u062C", "\uFEA1": "\u062D", "\uFEA2": "\u062D",
  "\uFEA3": "\u062D", "\uFEA4": "\u062D", "\uFEA5": "\u062E", "\uFEA6": "\u062E", "\uFEA7": "\u062E",
  "\uFEA8": "\u062E", "\uFEA9": "\u062F", "\uFEAA": "\u062F", "\uFEAB": "\u0630", "\uFEAC": "\u0630",
  "\uFEAD": "\u0631", "\uFEAE": "\u0631", "\uFEAF": "\u0632", "\uFEB0": "\u0632", "\uFEB1": "\u0633",
  "\uFEB2": "\u0633", "\uFEB3": "\u0633", "\uFEB4": "\u0633", "\uFEB5": "\u0634", "\uFEB6": "\u0634",
  "\uFEB7": "\u0634", "\uFEB8": "\u0634", "\uFEB9": "\u0635", "\uFEBA": "\u0635", "\uFEBB": "\u0635",
  "\uFEBC": "\u0635", "\uFEBD": "\u0636", "\uFEBE": "\u0636", "\uFEBF": "\u0636", "\uFEC0": "\u0636",
  "\uFEC1": "\u0637", "\uFEC2": "\u0637", "\uFEC3": "\u0637", "\uFEC4": "\u0637", "\uFEC5": "\u0638",
  "\uFEC6": "\u0638", "\uFEC7": "\u0638", "\uFEC8": "\u0638", "\uFEC9": "\u0639", "\uFECA": "\u0639",
  "\uFECB": "\u0639", "\uFECC": "\u0639", "\uFECD": "\u063A", "\uFECE": "\u063A", "\uFECF": "\u063A",
  "\uFED0": "\u063A", "\uFED1": "\u0641", "\uFED2": "\u0641", "\uFED3": "\u0641", "\uFED4": "\u0641",
  "\uFED5": "\u0642", "\uFED6": "\u0642", "\uFED7": "\u0642", "\uFED8": "\u0642", "\uFED9": "\u0643",
  "\uFEDA": "\u0643", "\uFEDB": "\u0643", "\uFEDC": "\u0643", "\uFEDD": "\u0644", "\uFEDE": "\u0644",
  "\uFEDF": "\u0644", "\uFEE0": "\u0644", "\uFEE1": "\u0645", "\uFEE2": "\u0645", "\uFEE3": "\u0645",
  "\uFEE4": "\u0645", "\uFEE5": "\u0646", "\uFEE6": "\u0646", "\uFEE7": "\u0646", "\uFEE8": "\u0646",
  "\uFEE9": "\u0647", "\uFEEA": "\u0647", "\uFEEB": "\u0647", "\uFEEC": "\u0647", "\uFEED": "\u0648",
  "\uFEEE": "\u0648", "\uFEEF": "\u0649", "\uFEF0": "\u0649", "\uFEF1": "\u064A", "\uFEF2": "\u064A",
  "\uFEF3": "\u064A", "\uFEF4": "\u064A", "\uFEF5": "\u0644\u0622", "\uFEF6": "\u0644\u0622",
  "\uFEF7": "\u0644\u0623", "\uFEF8": "\u0644\u0623", "\uFEF9": "\u0644\u0625", "\uFEFA": "\u0644\u0625",
  "\uFEFB": "\u0644\u0627", "\uFEFC": "\u0644\u0627",
};

/** Common Arabic words/parts: used only to score which candidate ordering is human-readable. */
const COMMON_WORDS = [
  "من", "في", "على", "إلى", "الى", "عن", "أن", "ان", "إن", "التي", "الذي", "هذا", "هذه", "ذلك",
  "كان", "كانت", "مع", "لا", "ما", "هو", "هي", "بين", "بعد", "قبل", "كل", "كما", "حيث", "تم",
  "يتم", "وقد", "قد", "هذا", "أو", "او", "ثم", "لكن", "عند", "حتى", "غير", "بن", "بين", "خلال",
  "العام", "التقرير", "المستند", "التي", "المالي", "الإيرادات", "الاداء", "الأداء", "الشهر",
  "الشهرية", "العربية", "النص", "الصفحة", "الملف", "الملفات", "تحويل", "دعم", "كامل", "بلغت",
  "بزيادة", "عن", "الماضي", "مع", "تحسن", "ملحوظ", "الربع", "الرابع", "نهاية", "إدارة", "الادارة",
  "السنة", "السنوي", "هذا", "تم", "إنشاء", "اختبار", "على", "أرقام", "ونص", "إنجليزي",
];

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_LETTER = /[\u0620-\u064A\u0660-\u0669\u066E-\u06D3\u06F0-\u06F9]/;
const COMBINING = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;

export function hasArabic(text = "") {
  return ARABIC_RANGE.test(text);
}

export function hasPresentationForms(text = "") {
  return /[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(text));
}

export function normalizeArabicForms(text = "") {
  let out = "";
  for (const ch of text) out += PRESENTATION_MAP[ch] || ch;
  return out.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
}

/** Shapes + bidi-reorders a logical string so pdf-lib/fontkit draws it correctly. */
export function shapeForPdf(text = "") {
  if (!hasArabic(text)) return text;
  const shaped = shaper.convertArabic(String(text));
  const levels = bidi.getEmbeddingLevels(shaped, "rtl");
  return bidi.getReorderedString(shaped, levels);
}

/**
 * Mirrors a visually-ordered (glyph order) line back to logical order.
 * Works on glyph clusters so Arabic ligatures (لا / لأ) survive intact.
 */
export function visualToLogical(text = "") {
  const source = String(text);
  if (!hasArabic(source)) return normalizeArabicForms(source);

  // 1. split into clusters (glyph + combining marks)
  const clusters = [];
  for (const ch of source) {
    if (COMBINING.test(ch) && clusters.length) {
      clusters[clusters.length - 1].chars.push(ch);
      continue;
    }
    clusters.push({ chars: [ch] });
  }

  // 2. reverse cluster order (LTR clusters are restored afterwards)
  clusters.reverse();

  // 3. restore internal order of runs that must stay left-to-right (Latin/digits)
  const isLtrCluster = (cluster) => {
    const ch = cluster.chars[0];
    return !ARABIC_RANGE.test(ch) && /[0-9A-Za-z\u00C0-\u024F\u0660-\u0669\u06F0-\u06F9.,%$+\-/]/.test(ch);
  };
  let i = 0;
  while (i < clusters.length) {
    if (!isLtrCluster(clusters[i])) { i += 1; continue; }
    let j = i;
    while (j < clusters.length && isLtrCluster(clusters[j])) j += 1;
    const run = clusters.slice(i, j).reverse();
    clusters.splice(i, j - i, ...run);
    i = j;
  }

  // 4. expand presentation forms to their logical characters
  let out = "";
  for (const cluster of clusters) {
    const head = cluster.chars[0];
    const rest = cluster.chars.slice(1).join("");
    out += (PRESENTATION_MAP[head] || head) + rest;
  }
  return out.replace(/\u0640/g, "");
}

/** Heuristic readability score for Arabic text (higher = more likely logical order). */
export function arabicPlausibility(text = "") {
  const value = String(text);
  if (!hasArabic(value)) return 0;
  let score = 0;
  for (const word of COMMON_WORDS) {
    const matches = value.split(new RegExp(`\\s${word}\\s|[\\s.,؛،:]${word}[\\s.,؛،:]`)).length - 1;
    if (matches > 0) score += matches * 6;
  }
  const words = value.split(/[\s.,؛،:()\[\]<>«»"'-]+/).filter((w) => ARABIC_LETTER.test(w));
  for (const word of words) {
    if (/^ال/.test(word)) score += 2;            // definite article at the start
    if (/^(و|ف|ب|ل|ك)(?=[\u0621-\u064A])/.test(word)) score += 1; // common prefixes
    if (/(ة|ات|ون|ين|هم|نا|ها|كم|ية)$/.test(word)) score += 1;    // common suffixes
    if (/^[ءأإؤئ]/.test(word)) score -= 1;        // words rarely start with hamza alone
    if (/لا$/.test(word)) score -= 2;             // mirrored "ال" often surfaces as trailing "لا"
    if (/^ة/.test(word)) score -= 2;
    if (/[\u064B-\u0652]{2,}/.test(word)) score -= 1;
  }
  const arabicChars = (value.match(ARABIC_RANGE) || []).length;
  score += Math.min(3, arabicChars / 40);
  return score;
}

/**
 * Picks the most readable logical form out of several extraction candidates
 * (visual order, mirrored order, content-stream order).
 */
export function bestLogicalText(candidates = []) {
  const list = candidates
    .map((raw) => String(raw || "").replace(/\s+/g, " ").trim())
    .filter((raw) => raw !== "");
  if (!list.length) return "";
  if (!list.some((text) => hasArabic(text))) return list[0];

  const scored = [];
  for (const candidate of list) {
    const direct = normalizeArabicForms(candidate);
    const mirrored = visualToLogical(candidate);
    scored.push({ text: direct, score: arabicPlausibility(direct) });
    scored.push({ text: mirrored, score: arabicPlausibility(mirrored) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0].text
    .replace(/\s+([\u064B-\u065F\u0670\u06D6-\u06ED])/g, "$1")
    .replace(/([\u064B-\u065F\u0670\u06D6-\u06ED])([\u0621-\u064A])/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Convenience wrapper kept for compatibility. */
export function fixExtractedLine(text = "") {
  return bestLogicalText([text]);
}
