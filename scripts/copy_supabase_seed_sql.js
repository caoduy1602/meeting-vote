const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const statePath = path.resolve(process.env.STATE_FILE || 'data/data.json');
const votersPath = path.resolve(process.env.VOTERS_FILE || 'config/voters.json');

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonbLiteral(value) {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    documents: Array.isArray(state.documents) ? state.documents : [],
    votes: state.votes && typeof state.votes === 'object' ? state.votes : {},
    currentDocId: state.currentDocId ?? null,
    templates: Array.isArray(state.templates) ? state.templates : []
  };
}

function main() {
  if (!fs.existsSync(votersPath)) throw new Error(`Voter file not found: ${votersPath}`);
  const voters = JSON.parse(fs.readFileSync(votersPath, 'utf8'));
  if (!Array.isArray(voters) || !voters.length) throw new Error('Voter file must contain a non-empty array.');
  const state = fs.existsSync(statePath)
    ? normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')))
    : normalizeState({});

  const voterRows = voters.map(voter => {
    if (!voter || !voter.id || !voter.name) throw new Error('Every voter needs an id and name.');
    const salt = crypto.randomBytes(16);
    const pinHash = crypto.pbkdf2Sync(String(voter.pin || ''), salt, 210000, 32, 'sha256').toString('hex');
    return `(${sqlLiteral(voter.id)}, ${sqlLiteral(voter.name)}, ${sqlLiteral(salt.toString('hex'))}, ${sqlLiteral(pinHash)})`;
  });

  const currentDocId = state.currentDocId === null ? 'NULL' : sqlLiteral(state.currentDocId);
  const voterIds = voters.map(voter => sqlLiteral(voter.id)).join(', ');
  const statements = [
    'BEGIN;',
    'INSERT INTO public.meeting_vote_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;',
    `UPDATE public.meeting_vote_state SET documents = ${jsonbLiteral(state.documents)}, votes = ${jsonbLiteral(state.votes)}, current_doc_id = ${currentDocId}, templates = ${jsonbLiteral(state.templates)}, version = version + 1, updated_at = NOW() WHERE id = 1;`,
    `INSERT INTO public.meeting_vote_voters (id, name, pin_salt, pin_hash) VALUES ${voterRows.join(', ')} ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pin_salt = EXCLUDED.pin_salt, pin_hash = EXCLUDED.pin_hash;`,
    `DELETE FROM public.meeting_vote_voters WHERE id NOT IN (${voterIds});`,
    'COMMIT;'
  ];

  process.stdout.write(statements.join('\n'));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}