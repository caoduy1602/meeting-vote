const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL not set. Set this to a test Postgres database to run persistence tests.');
  process.exit(2);
}

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');
function normalizeState(data) {
  const safeData = data && typeof data === 'object' ? data : {};
  return {
    documents: Array.isArray(safeData.documents) ? safeData.documents : [],
    votes: safeData.votes && typeof safeData.votes === 'object' ? safeData.votes : {},
    currentDocId: safeData.currentDocId ?? null,
    templates: Array.isArray(safeData.templates) ? safeData.templates : []
  };
}

async function run() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const testTable = 'meeting_vote_state_test';

  try {
    // Ensure table exists (test-specific table)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${testTable} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        documents JSONB NOT NULL DEFAULT '[]'::jsonb,
        votes JSONB NOT NULL DEFAULT '{}'::jsonb,
        current_doc_id TEXT,
        templates JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read local data.json
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Local data file not found: ${DATA_FILE}`);
    }
    const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent);
    const imported = normalizeState(parsed);

    // Clean previous test row if exists
    await pool.query(`DELETE FROM ${testTable} WHERE id = 1`);

    // Insert imported data into test table
    await pool.query(`
      INSERT INTO ${testTable} (id, documents, votes, current_doc_id, templates, updated_at)
      VALUES (1, $1::jsonb, $2::jsonb, $3, $4::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        documents = EXCLUDED.documents,
        votes = EXCLUDED.votes,
        current_doc_id = EXCLUDED.current_doc_id,
        templates = EXCLUDED.templates,
        updated_at = NOW()
    `, [
      JSON.stringify(imported.documents),
      JSON.stringify(imported.votes),
      imported.currentDocId,
      JSON.stringify(imported.templates)
    ]);

    console.log('Imported data.json into test table.');

    // Read back and verify
    const res1 = await pool.query(`SELECT documents, votes, current_doc_id, templates FROM ${testTable} WHERE id = 1`);
    if (res1.rows.length === 0) throw new Error('No row found after import');
    const row = res1.rows[0];
    const loaded = normalizeState({ documents: row.documents, votes: row.votes, currentDocId: row.current_doc_id, templates: row.templates });

    // Basic equality checks
    if (JSON.stringify(loaded.documents) !== JSON.stringify(imported.documents)) throw new Error('Documents mismatch after import');
    if (JSON.stringify(loaded.votes) !== JSON.stringify(imported.votes)) throw new Error('Votes mismatch after import');

    console.log('Import verification passed.');

    // Save a new state (add a document)
    const newDoc = { id: 'test_' + Date.now(), title: 'Test doc', content: 'This is a test', status: 'open', createdAt: Date.now(), yes: 0, no: 0, blank: 0 };
    const modified = Object.assign({}, loaded);
    modified.documents = [newDoc, ...modified.documents];

    await pool.query(`
      INSERT INTO ${testTable} (id, documents, votes, current_doc_id, templates, updated_at)
      VALUES (1, $1::jsonb, $2::jsonb, $3, $4::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        documents = EXCLUDED.documents,
        votes = EXCLUDED.votes,
        current_doc_id = EXCLUDED.current_doc_id,
        templates = EXCLUDED.templates,
        updated_at = NOW()
    `, [
      JSON.stringify(modified.documents),
      JSON.stringify(modified.votes),
      modified.currentDocId,
      JSON.stringify(modified.templates)
    ]);

    console.log('Saved modified state to test table.');

    // Read back and confirm
    const res2 = await pool.query(`SELECT documents FROM ${testTable} WHERE id = 1`);
    const row2 = res2.rows[0];
    const documentsAfter = row2.documents || [];
    if (!Array.isArray(documentsAfter)) throw new Error('documents column not array after save');
    if (documentsAfter.length === 0 || documentsAfter[0].id !== newDoc.id) throw new Error('New document not found after save');

    console.log('Save verification passed.');

    // Simulate restart: close pool and reconnect
    await pool.end();
    const pool2 = new Pool({ connectionString: TEST_DATABASE_URL });
    const res3 = await pool2.query(`SELECT documents FROM ${testTable} WHERE id = 1`);
    const row3 = res3.rows[0];
    const documentsAfterRestart = row3.documents || [];
    if (!Array.isArray(documentsAfterRestart)) throw new Error('documents column not array after restart');
    if (documentsAfterRestart.length === 0 || documentsAfterRestart[0].id !== newDoc.id) throw new Error('New document missing after restart');

    console.log('Restart verification passed.');

    // Ensure data.json not deleted or overwritten with empty
    const fileContentAfter = fs.readFileSync(DATA_FILE, 'utf-8');
    if (!fileContentAfter || fileContentAfter.trim().length === 0) throw new Error('data.json appears empty after tests');
    const parsedAfter = JSON.parse(fileContentAfter);
    if (!parsedAfter) throw new Error('data.json parse failed after tests');

    console.log('data.json remains present and parseable.');

    // Clean up: remove test row
    await pool2.query(`DELETE FROM ${testTable} WHERE id = 1`);
    await pool2.end();

    console.log('All persistence tests passed.');
    process.exit(0);
  } catch (err) {
    console.error('Persistence test failed:', err);
    try { await pool.end(); } catch (e) {}
    process.exit(1);
  }
}

run();
