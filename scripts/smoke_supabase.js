require('dotenv').config({ path: '.env.supabase' });
require('dotenv').config({ path: '.env.supabase-function' });

async function main() {
  const baseUrl = `${process.env.SUPABASE_URL}/functions/v1/meeting-vote`;
  const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY };
  if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is not configured.');

  const [stateResponse, votersResponse] = await Promise.all([
    fetch(`${baseUrl}/api/state`, { headers }),
    fetch(`${baseUrl}/api/voters`, { headers })
  ]);
  const state = await stateResponse.json();
  const voters = await votersResponse.json();

  const loginResponse = await fetch(`${baseUrl}/api/login/admin`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });
  const login = await loginResponse.json();
  const exportResponse = login.token
    ? await fetch(`${baseUrl}/api/export`, { headers: { ...headers, Authorization: `Bearer ${login.token}` } })
    : null;

  const result = {
    stateStatus: stateResponse.status,
    voterStatus: votersResponse.status,
    voterCount: Array.isArray(voters) ? voters.length : null,
    adminLoginStatus: loginResponse.status,
    exportStatus: exportResponse?.status ?? null,
    exportType: exportResponse?.headers.get('content-type') ?? null,
    currentDoc: state.currentDoc?.title ?? null
  };
  console.log(JSON.stringify(result, null, 2));
  if (!stateResponse.ok || !votersResponse.ok || !loginResponse.ok || !exportResponse?.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error('Supabase smoke test failed:', error.message);
  process.exitCode = 1;
});