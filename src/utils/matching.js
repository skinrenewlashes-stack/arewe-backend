/**
 * AreWe? Matching Algorithm
 *
 * Weights:
 *   first_name      25%
 *   city+state      20%
 *   age_range       15%
 *   race            15%
 *   industry        10%
 *   lifestyle       10%
 *   car_model        5%
 *
 * Rules:
 * - Only score fields that are present in BOTH submissions
 * - Normalize final score to 0-100 based on available weight
 * - Return per-category breakdown: 'match' | 'partial' | 'none'
 */

const levenshtein = require('fast-levenshtein');

const WEIGHTS = {
  firstName: 25,
  location: 20,
  ageRange: 15,
  race: 15,
  industry: 10,
  lifestyle: 10,
  carModel: 5,
};

const AGE_RANGE_ORDER = ['18-24', '25-30', '31-35', '36-40', '41-45', '46-50', '51+'];

function normalizeString(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalize(str) {
  return normalizeString(str).replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  const distance = levenshtein.get(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

function isNameMatch(a, b) {
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  if (!normalizedA || !normalizedB) return false;
  return similarity(normalizedA, normalizedB) > 0.8;
}

function isCityMatch(a, b) {
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  if (!normalizedA || !normalizedB) return false;
  return similarity(normalizedA, normalizedB) > 0.75;
}

function scoreFirstName(a, b) {
  if (!a || !b) return null;
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  const na = normalize(a);
  const nb = normalize(b);
  if (normalizedA === normalizedB) return { score: 1, status: 'exact' };
  if (isNameMatch(a, b)) return { score: 0.5, status: 'partial' };
  if (na.startsWith(nb) || nb.startsWith(na)) return { score: 0.5, status: 'partial' };
  return { score: 0, status: 'none' };
}

function scoreLocation(cityA, stateA, cityB, stateB) {
  if (!cityA || !stateA || !cityB || !stateB) return null;
  const cityMatch = normalize(cityA) === normalize(cityB) || isCityMatch(cityA, cityB);
  const stateMatch = normalize(stateA) === normalize(stateB);
  if (cityMatch && stateMatch) return { score: 1, status: 'match' };
  if (stateMatch) return { score: 0.4, status: 'partial' };
  return { score: 0, status: 'none' };
}

function scoreAgeRange(a, b) {
  if (!a || !b) return null;
  if (a === b) return { score: 1, status: 'match' };
  const idxA = AGE_RANGE_ORDER.indexOf(a);
  const idxB = AGE_RANGE_ORDER.indexOf(b);
  if (idxA === -1 || idxB === -1) return { score: 0, status: 'none' };
  const diff = Math.abs(idxA - idxB);
  if (diff === 1) return { score: 0.5, status: 'partial' };
  return { score: 0, status: 'none' };
}

function scoreRace(a, b) {
  if (!a || !b) return null;
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  if (normalizedA === normalizedB) return { score: 1, status: 'match' };
  return { score: 0, status: 'none' };
}

function scoreIndustry(a, b) {
  if (!a || !b) return null;
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  if (normalizedA === normalizedB) return { score: 1, status: 'match' };
  const wordsA = normalizedA.split(/\s+/);
  const wordsB = normalizedB.split(/\s+/);
  const shared = wordsA.filter((w) => w.length > 3 && wordsB.includes(w));
  if (shared.length > 0) return { score: 0.5, status: 'partial' };
  return { score: 0, status: 'none' };
}

function scoreLifestyle(a, b) {
  if (!a || !b || !Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || b.length === 0) return null;
  const setA = new Set(a.map(normalize));
  const setB = new Set(b.map(normalize));
  const intersection = [...setA].filter((x) => setB.has(x));
  const union = new Set([...setA, ...setB]);
  const ratio = intersection.length / union.size;
  if (ratio >= 0.6) return { score: 1, status: 'match' };
  if (ratio >= 0.2) return { score: ratio, status: 'partial' };
  return { score: 0, status: 'none' };
}

function scoreCarModel(a, b) {
  if (!a || !b) return null;
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);
  if (normalizedA === normalizedB) return { score: 1, status: 'match' };
  const wordsA = normalizedA.split(/\s+/);
  const wordsB = normalizedB.split(/\s+/);
  const shared = wordsA.filter((w) => w.length > 2 && wordsB.includes(w));
  if (shared.length > 0) return { score: 0.5, status: 'partial' };
  return { score: 0, status: 'none' };
}

function getTier(percentage) {
  if (percentage >= 78) return 'high';
  if (percentage >= 40) return 'moderate';
  return 'low';
}

/**
 * Main match function
 * @param {Object} subA - submission A row from DB
 * @param {Object} subB - submission B row from DB
 * @returns {{ percentage: number, tier: string, breakdown: Object }}
 */
function computeMatch(subA, subB) {
  const scores = {
    firstName: scoreFirstName(subA.first_name, subB.first_name),
    location: scoreLocation(subA.city, subA.state_province, subB.city, subB.state_province),
    ageRange: scoreAgeRange(subA.age_range, subB.age_range),
    race: scoreRace(subA.race, subB.race),
    industry: scoreIndustry(subA.industry, subB.industry),
    lifestyle: scoreLifestyle(subA.lifestyle_habits, subB.lifestyle_habits),
    carModel: scoreCarModel(subA.car_model, subB.car_model),
  };

  let totalWeight = 0;
  let earnedScore = 0;
  const breakdown = {};

  for (const [field, result] of Object.entries(scores)) {
    if (result === null) {
      breakdown[field] = 'none';
      continue;
    }
    const weight = WEIGHTS[field];
    totalWeight += weight;
    earnedScore += result.score * weight;
    breakdown[field] = result.status;
  }

  let percentage = totalWeight === 0 ? 0 : Math.round((earnedScore / totalWeight) * 100);

  if (scores.firstName && scores.firstName.score === 0 && percentage > 70) {
    percentage = 70;
  }

  const tier = getTier(percentage);

  return { percentage, tier, breakdown };
}

module.exports = { computeMatch, getTier };
