import { SECTION_MATH, SECTION_RW } from './taxonomy.js';

/**
 * LAYER 1 of the architecture: everything in this file is plain arithmetic
 * over the student's real rows. No LLM involved. Groq only ever interprets
 * the object this module produces - it never calculates statistics itself.
 */

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// Mirrors the exact weakness-score formula already used in src/SATTracker.jsx
// (topicStats / the Review page), so the AI Analysis page and the Review
// page never disagree about which topics are weak.
function baseWeaknessScore(s) {
  return s.total * 1 + s.unreviewed * 2 + s.reviewing * 1 - s.mastered * 1.5;
}

function topicStats(errors) {
  const map = new Map();
  errors.forEach((e) => {
    const key = `${e.topic}||${e.domain}||${e.section}`;
    if (!map.has(key)) {
      map.set(key, {
        topic: e.topic, domain: e.domain, section: e.section,
        total: 0, unreviewed: 0, reviewing: 0, mastered: 0,
        testIds: new Set(), dates: [], lastMistake: null,
      });
    }
    const s = map.get(key);
    s.total += 1;
    if (e.status === 'Unreviewed') s.unreviewed += 1;
    else if (e.status === 'Reviewing') s.reviewing += 1;
    else if (e.status === 'Mastered') s.mastered += 1;
    if (e.testId) s.testIds.add(e.testId);
    s.dates.push(e.date);
    if (!s.lastMistake || e.date > s.lastMistake.date) s.lastMistake = e;
  });
  return Array.from(map.values());
}

// isolated | emerging | recurring weakness | severe persistent weakness
function classify(stat) {
  const open = stat.unreviewed + stat.reviewing;
  const testsAppearedIn = stat.testIds.size;
  if (stat.total <= 1) return 'isolated mistake';
  if (testsAppearedIn >= 3 && open >= Math.ceil(stat.total * 0.6)) return 'severe persistent weakness';
  if (testsAppearedIn >= 2 || stat.total >= 3) return 'recurring weakness';
  return 'emerging weakness';
}

// Weakness Priority = severity (base score) x frequency/persistence x recency.
// Kept as an additive, explainable formula rather than a black box.
function priorityScore(stat, latestTestId) {
  const base = baseWeaknessScore(stat);
  const persistenceBonus = stat.testIds.size * 1.5;
  const recencyBonus = latestTestId && stat.testIds.has(latestTestId) ? 1.5 : 0;
  return Math.round((base + persistenceBonus + recencyBonus) * 10) / 10;
}

function dataMaturity(testsTaken, errorsCount) {
  if (testsTaken === 0 && errorsCount === 0) return 'none';
  if (testsTaken <= 1 && errorsCount < 4) return 'minimal';
  if (testsTaken <= 3 || errorsCount < 10) return 'developing';
  return 'established';
}

function sectionSummary(tests, section) {
  const scores = tests.map((t) => (section === SECTION_MATH ? t.mathScore : t.rwScore));
  if (!scores.length) return { latestScore: null, averageScore: null, bestScore: null, trend: null };
  return {
    latestScore: scores[scores.length - 1],
    averageScore: avg(scores),
    bestScore: Math.max(...scores),
    trend: scores.length >= 2 ? scores[scores.length - 1] - scores[0] : null,
  };
}

function groupCount(items, key) {
  const map = new Map();
  items.forEach((i) => map.set(i[key], (map.get(i[key]) || 0) + 1));
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/**
 * Compares the current category list against the previous cached profile's
 * category list (matched by domain+topic+section) to deterministically
 * classify each as improving / declining / stable / resolved / new. Groq
 * only narrates these pre-computed classifications - it never decides them.
 */
function computeImprovement(currentCategories, previousProfile) {
  if (!previousProfile || !Array.isArray(previousProfile.categories)) {
    return { hasPrevious: false, categoryDeltas: [] };
  }
  const prevMap = new Map(previousProfile.categories.map((c) => [`${c.domain}||${c.topic}||${c.section}`, c]));
  const currMap = new Map(currentCategories.map((c) => [`${c.domain}||${c.topic}||${c.section}`, c]));
  const deltas = [];

  currMap.forEach((curr, key) => {
    const prev = prevMap.get(key);
    if (!prev) {
      deltas.push({ domain: curr.domain, topic: curr.topic, section: curr.section, status: 'new', previousPriority: null, currentPriority: curr.priority });
      return;
    }
    const diff = curr.priority - prev.priority;
    const currOpen = curr.unreviewed + curr.reviewing;
    let status = 'stable';
    if (currOpen === 0 && (prev.unreviewed + prev.reviewing) > 0) status = 'resolved';
    else if (diff <= -1.5) status = 'improving';
    else if (diff >= 1.5) status = 'declining';
    deltas.push({ domain: curr.domain, topic: curr.topic, section: curr.section, status, previousPriority: prev.priority, currentPriority: curr.priority });
  });

  prevMap.forEach((prev, key) => {
    if (!currMap.has(key) && (prev.unreviewed + prev.reviewing) > 0) {
      deltas.push({ domain: prev.domain, topic: prev.topic, section: prev.section, status: 'resolved', previousPriority: prev.priority, currentPriority: null });
    }
  });

  return { hasPrevious: true, categoryDeltas: deltas.slice(0, 15) };
}

export function buildPerformanceProfile(tests, errors, previousProfile) {
  const sortedTests = [...tests].sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = sortedTests.map((t) => t.totalScore);
  const latestTest = sortedTests[sortedTests.length - 1] || null;

  const stats = topicStats(errors);
  const categories = stats
    .map((s) => ({
      domain: s.domain,
      topic: s.topic,
      section: s.section,
      totalMistakes: s.total,
      unreviewed: s.unreviewed,
      reviewing: s.reviewing,
      mastered: s.mastered,
      testsAppearedIn: s.testIds.size,
      classification: classify(s),
      priority: priorityScore(s, latestTest?.id || null),
    }))
    .sort((a, b) => b.priority - a.priority);

  const topPriority = categories.filter((c) => c.unreviewed + c.reviewing > 0).slice(0, 4);
  const representativeMistakes = [];
  topPriority.forEach((cat) => {
    const matches = errors
      .filter((e) => e.domain === cat.domain && e.topic === cat.topic && e.section === cat.section && e.status !== 'Mastered')
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 2);
    matches.forEach((e) => {
      if (representativeMistakes.length < 8) {
        representativeMistakes.push({
          domain: e.domain, topic: e.topic, section: e.section, date: e.date,
          description: e.description, reason: e.reason, explanation: e.explanation,
          difficulty: e.difficulty, status: e.status,
        });
      }
    });
  });

  const profile = {
    generatedAt: new Date().toISOString(),
    dataMaturity: dataMaturity(tests.length, errors.length),
    overall: {
      testsTaken: tests.length,
      latestScore: latestTest ? latestTest.totalScore : null,
      averageScore: avg(totals),
      bestScore: totals.length ? Math.max(...totals) : null,
      lowestScore: totals.length ? Math.min(...totals) : null,
      scoreTrend: totals.length >= 2 ? totals[totals.length - 1] - totals[0] : null,
    },
    sections: {
      [SECTION_MATH]: sectionSummary(sortedTests, SECTION_MATH),
      [SECTION_RW]: sectionSummary(sortedTests, SECTION_RW),
    },
    categories,
    mistakeReasons: groupCount(errors, 'reason'),
    // Distribution of difficulty AMONG LOGGED MISTAKES ONLY. This app does not
    // record every question attempted, only ones the student got wrong and
    // chose to log - so this is not an accuracy-by-difficulty metric, and
    // must not be described as one.
    difficultyDistribution: groupCount(errors, 'difficulty'),
    statusBreakdown: {
      unreviewed: errors.filter((e) => e.status === 'Unreviewed').length,
      reviewing: errors.filter((e) => e.status === 'Reviewing').length,
      mastered: errors.filter((e) => e.status === 'Mastered').length,
    },
    recentTests: [...sortedTests].reverse().slice(0, 5).map((t) => ({
      name: t.name, date: t.date, totalScore: t.totalScore, mathScore: t.mathScore, rwScore: t.rwScore,
    })),
    representativeMistakes,
  };

  profile.improvementContext = computeImprovement(categories, previousProfile);
  return profile;
}

// A short, stable string that changes only when the underlying data actually
// changes - used to decide whether a cached analysis is still valid.
export function computeFingerprint(tests, errors, config) {
  const testsPart = tests.map((t) => `${t.id}:${t.totalScore}`).sort().join(',');
  const errorsPart = errors.map((e) => `${e.id}:${e.status}`).sort().join(',');
  const goalsPart = `${config?.targetTotal || ''}:${config?.targetMath || ''}:${config?.targetRW || ''}`;
  return `${tests.length}-${errors.length}-${hashString(testsPart + '|' + errorsPart + '|' + goalsPart)}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
