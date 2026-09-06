import { setCors } from '../_lib/cors.js';
import { getAuthenticatedUser } from '../_lib/supabaseClient.js';

// Flattens a row from admin_list_questions() into the shape the frontend
// uses - same field-flattening convention as rowToQuestion() in
// api/practice-question.js.
function rowToQuestion(row) {
  const content = row.question || {};
  return {
    id: row.id,
    section: row.section,
    domain: row.domain,
    topic: row.topic,
    difficulty: row.difficulty,
    model: row.model || '',
    createdAt: row.created_at,
    viewCount: Number(row.view_count) || 0,
    stem: content.stem,
    choices: content.choices,
    correctChoiceId: content.correctChoiceId,
    explanation: content.explanation,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Check #1: a valid, non-blocked, authenticated Supabase session.
  const { client, user, error: authError, blocked } = await getAuthenticatedUser(req);
  if (!user) { res.status(blocked ? 403 : 401).json({ error: authError || 'Not authenticated' }); return; }

  // Check #2: independent of check #3 below - the caller's real id (from
  // their verified JWT) must match our own env var.
  if (!process.env.ADMIN_USER_ID || user.id !== process.env.ADMIN_USER_ID) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const action = req.body?.action;

  try {
    // Check #3: admin_list_questions()/admin_delete_question() independently
    // re-verify auth.uid() against the hardcoded admin uid inside Postgres.
    if (action === 'list') {
      const filters = req.body?.filters || {};
      const { data, error } = await client.rpc('admin_list_questions', {
        p_section: filters.section || null,
        p_domain: filters.domain || null,
        p_topic: filters.topic || null,
        p_difficulty: filters.difficulty || null,
      });
      if (error) throw error;
      res.status(200).json({ questions: (data || []).map(rowToQuestion) });
      return;
    }

    if (action === 'delete') {
      const questionId = req.body?.questionId;
      if (!questionId || typeof questionId !== 'string') { res.status(400).json({ error: 'questionId is required' }); return; }
      const { error } = await client.rpc('admin_delete_question', { p_question_id: questionId });
      if (error) throw error;
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(400).json({ error: 'Unknown or missing action.' });
  } catch (err) {
    console.error('admin/questions unexpected error', err?.message);
    const message = /not found/i.test(err?.message || '') ? err.message : 'Something went wrong loading the question pool.';
    res.status(500).json({ error: message });
  }
}
