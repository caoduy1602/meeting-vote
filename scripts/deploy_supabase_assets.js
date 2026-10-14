require('dotenv').config({ path: process.env.SUPABASE_ENV_FILE || '.env.supabase' });

const fs = require('fs');
const path = require('path');

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'meeting-vote-site';
const publicDir = path.resolve('public');

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  })[extension] || 'application/octet-stream';
}

async function collectFiles(directory, prefix = '') {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolutePath, relativePath));
    else if (entry.isFile()
      && !relativePath.split('/').some(part => part.startsWith('.'))
      && entry.name !== 'supabase-config.js') {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

async function main() {
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY in .env.supabase.');
  }

  const authHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  const existingBucket = await fetch(bucketUrl, { headers: authHeaders });
  if (existingBucket.status === 404) {
    const createBucket = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true })
    });
    if (!createBucket.ok && createBucket.status !== 409) {
      throw new Error(`Could not create public storage bucket (${createBucket.status}).`);
    }
  } else if (!existingBucket.ok) {
    throw new Error(`Could not check storage bucket (${existingBucket.status}).`);
  }
  const makeBucketPublic = await fetch(bucketUrl, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public: true })
  });
  if (!makeBucketPublic.ok) throw new Error(`Could not configure public storage bucket (${makeBucketPublic.status}).`);

  const functionUrl = `${supabaseUrl}/functions/v1/meeting-vote`;
  const config = `window.MEETING_VOTE_CONFIG = ${JSON.stringify({ url: supabaseUrl, publishableKey, functionUrl })};\n`;
  const files = await collectFiles(publicDir);
  files.push({ absolutePath: path.join(publicDir, 'index.html'), relativePath: 'site.html' });
  files.push({ relativePath: 'supabase-config.js', content: Buffer.from(config) });

  for (const file of files) {
    const encodedPath = file.relativePath.split('/').map(encodeURIComponent).join('/');
    const body = file.content || await fs.promises.readFile(file.absolutePath);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': contentType(file.relativePath),
        'x-upsert': 'true',
        'cache-control': 'max-age=60'
      },
      body
    });
    if (!response.ok) throw new Error(`Upload failed for ${file.relativePath} (${response.status}).`);
    console.log(`Uploaded ${file.relativePath}`);
  }

  console.log(`Frontend URL: ${supabaseUrl}/storage/v1/object/public/${bucket}/index.html`);
}

main().catch(error => {
  console.error('Supabase asset deploy failed:', error.message);
  process.exitCode = 1;
});