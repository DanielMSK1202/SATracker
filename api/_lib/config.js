// Small shared constants used by more than one api/ route. Kept separate
// from taxonomy.js (which mirrors frontend category data) since this is
// server-only operational config, not domain taxonomy.

// Max NEW Gemini generations per user per calendar day. Defined once here so
// api/practice-question.js (which enforces it) and api/admin/users.js (which
// only displays it, for the Quota tab) can't drift out of sync.
export const MAX_DAILY_GENERATIONS = 3;
