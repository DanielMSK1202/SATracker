const CONFIDENCE_VALUES = ['high', 'medium', 'low'];
const SEVERITY_VALUES = ['high', 'medium', 'low'];
const IMPROVEMENT_STATUS_VALUES = ['improving', 'declining', 'stable', 'resolved', 'new'];

function str(v, fallback = '') {
  return typeof v === 'string' ? v.trim() : fallback;
}
function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function oneOf(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}
function strList(v, max) {
  return arr(v).filter((x) => typeof x === 'string' && x.trim()).slice(0, max);
}

// Builds the set of every domain/topic name that actually exists in the
// student's real data, so any category the model mentions can be checked
// against reality instead of trusted blindly.
function knownCategoryNames(profile) {
  const names = new Set();
  (profile.categories || []).forEach((c) => { names.add(c.topic); names.add(c.domain); });
  return names;
}

/**
 * Validates and sanitizes the global analysis response. Returns a fully safe
 * object even if the model's output was partially malformed - unknown
 * categories are dropped rather than trusted, enums are clamped, and array
 * lengths are capped.
 */
export function validateGlobalAnalysis(raw, profile) {
  if (!raw || typeof raw !== 'object') throw new Error('AI response was not a valid object.');
  const known = knownCategoryNames(profile);

  const overallAssessment = {
    summary: str(raw.overallAssessment?.summary, 'Analysis unavailable.'),
    confidence: oneOf(raw.overallAssessment?.confidence, CONFIDENCE_VALUES, 'low'),
  };

  const strengths = arr(raw.strengths).slice(0, 6).map((s) => ({
    title: str(s?.title),
    description: str(s?.description),
    evidence: str(s?.evidence),
  })).filter((s) => s.title);

  const weaknesses = arr(raw.weaknesses).slice(0, 6).map((w) => ({
    title: str(w?.title),
    category: str(w?.category),
    section: str(w?.section),
    severity: oneOf(w?.severity, SEVERITY_VALUES, 'medium'),
    description: str(w?.description),
    evidence: str(w?.evidence),
    whyItMatters: str(w?.whyItMatters),
    howToImprove: strList(w?.howToImprove, 5),
  })).filter((w) => w.title && (known.size === 0 || known.has(w.category) || w.category === ''));

  const recurringPatterns = arr(raw.recurringPatterns).slice(0, 8).map((p) => ({
    title: str(p?.title),
    frequency: num(p?.frequency, 0),
    description: str(p?.description),
    evidence: str(p?.evidence),
    solution: str(p?.solution),
  })).filter((p) => p.title);

  const improvement = arr(raw.improvement).slice(0, 10).map((i) => ({
    area: str(i?.area),
    status: oneOf(i?.status, IMPROVEMENT_STATUS_VALUES, 'stable'),
    description: str(i?.description),
  })).filter((i) => i.area);

  const studyPriorities = arr(raw.studyPriorities).slice(0, 5).map((p, idx) => ({
    priority: num(p?.priority, idx + 1),
    topic: str(p?.topic),
    reason: str(p?.reason),
    recommendedPractice: str(p?.recommendedPractice),
  })).filter((p) => p.topic);

  const testStrategy = strList(raw.testStrategy, 4);

  return { overallAssessment, strengths, weaknesses, recurringPatterns, improvement, studyPriorities, testStrategy };
}

export function validateMistakeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('AI response was not a valid object.');
  return {
    skillTested: str(raw.skillTested, 'Not determined'),
    mistakeExplanation: str(raw.mistakeExplanation),
    likelyMistakeType: str(raw.likelyMistakeType, 'Unclear from available data'),
    howToFix: strList(raw.howToFix, 5),
    rememberThis: str(raw.rememberThis),
    relatedPattern: str(raw.relatedPattern, 'Not enough history yet to identify a pattern.'),
  };
}
