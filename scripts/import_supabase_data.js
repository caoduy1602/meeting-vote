require('dotenv').config({ path: process.env.SUPABASE_ENV_FILE || '.env.supabase' });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const statePath = path.resolve(process.env.STATE_FILE || 'data/data.json');
const votersPath = path.resolve(process.env.VOTERS_FILE || 'config/voters.json');

function normalizeState(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    documents: Array.isArray(value.documents) ? value.documents : [],
    votes: value.votes && typeof value.votes === 'object' ? value.votes : {},
    currentDocId: value.currentDocId ?? null,
    templates: Array.isArray(value.templates) ? value.templates : []
  };
}

function isEmptyState(state) {
  return !state.documents.length
    && !Object.keys(state.votes).length
    && !state.currentDocId
    && !state.templates.length;
}

async function main() {
  if (!databaseUrl) throw new Error('Set SUPABASE_DB_URL in .env.supabase first.');
  if (!fs.existsSync(votersPath)) throw new Error(`Voter file not found: ${votersPath}`);

  const voters = JSON.parse(fs.readFileSync(votersPath, 'utf8'));
  if (!Array.isArray(voters) || !voters.length) throw new Error('Voter file must contain a non-empty array.');
  const state = fs.existsSync(statePath)
    ? normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')))
    : normalizeState({});
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT documents, votes, current_doc_id, templates FROM public.meeting_vote_state WHERE id = 1 FOR UPDATE');
    if (!existing.rowCount) throw new Error('Supabase schema is missing; run `npx supabase db push` first.');

    const currentState = normalizeState({
      documents: existing.rows[0].documents,
      votes: existing.rows[0].votes,
      currentDocId: existing.rows[0].current_doc_id,
      templates: existing.rows[0].templates
    });
    if (process.env.FORCE_IMPORT_STATE === 'true' || isEmptyState(currentState)) {
      await client.query(`
        UPDATE public.meeting_vote_state
        SET documents = $1::jsonb, votes = $2::jsonb, current_doc_id = $3,
            templates = $4::jsonb, version = version + 1, updated_at = NOW()
        WHERE id = 1
      `, [JSON.stringify(state.documents), JSON.stringify(state.votes), state.currentDocId, JSON.stringify(state.templates)]);
      console.log(`Imported documents: ${state.documents.length}; templates: ${state.templates.length}.`);
    } else {
      console.log('Existing Supabase state is non-empty; keeping it unchanged.');
    }

    for (const voter of voters) {
      if (!voter || !voter.id || !voter.name) throw new Error('Every voter needs an id and name.');
      const pinSalt = crypto.randomBytes(16).toString('hex');
      const pinHash = crypto.pbkdf2Sync(String(voter.pin || ''), Buffer.from(pinSalt, 'hex'), 210000, 32, 'sha256').toString('hex');
      await client.query(`
        INSERT INTO public.meeting_vote_voters (id, name, pin_salt, pin_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pin_salt = EXCLUDED.pin_salt, pin_hash = EXCLUDED.pin_hash
      `, [String(voter.id), String(voter.name), pinSalt, pinHash]);
    }
    await client.query(
      'DELETE FROM public.meeting_vote_voters WHERE NOT (id = ANY($1::text[]))',
      [voters.map(voter => String(voter.id))]
    );

    await client.query('COMMIT');
    console.log(`Imported voters: ${voters.length}. PIN values were stored as salted PBKDF2 hashes.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Supabase import failed:', error.message);
  process.exitCode = 1;
});