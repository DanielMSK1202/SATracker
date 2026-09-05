// Kept in sync with the same constants in src/SATTracker.jsx (SECTION_MATH,
// SECTION_RW, DOMAINS, REASONS, DIFFICULTIES, STATUSES). Duplicated here
// because this function runs in Deno, a separate runtime from the Vite/React
// app, and these are plain data with no framework dependency.

export const SECTION_MATH = 'Math';
export const SECTION_RW = 'Reading & Writing';

export const DOMAINS = {
  [SECTION_MATH]: ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'],
  [SECTION_RW]: ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'],
};

export const REASONS = [
  'Careless error', 'Misread the question', "Didn't know the concept", 'Ran out of time',
  'Wrong strategy or approach', 'Overcomplicated it', 'Second-guessed the correct answer', 'Other',
];
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
export const STATUSES = ['Unreviewed', 'Reviewing', 'Mastered'];

// Maps the app's existing free-text mistake reasons onto the mistake-type
// taxonomy requested for AI analysis, so the model interprets an existing,
// real field rather than inventing its own classification scheme.
export const REASON_TO_MISTAKE_TYPE = {
  'Careless error': 'careless',
  'Misread the question': 'misreading',
  "Didn't know the concept": 'conceptual',
  'Ran out of time': 'time-management',
  'Wrong strategy or approach': 'strategy',
  'Overcomplicated it': 'strategy',
  'Second-guessed the correct answer': 'strategy',
  Other: 'other',
};
