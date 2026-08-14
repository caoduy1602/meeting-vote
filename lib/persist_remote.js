const axios = require('axios');

async function getFromRemote(url, auth) {
  if (!url) return null;
  try {
    const headers = {};
    if (auth) headers.Authorization = auth;
    const res = await axios.get(url, { headers, timeout: 10000 });
    if (res && res.data) return { content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function putToRemote(url, auth, content) {
  if (!url) throw new Error('REMOTE_PERSIST_URL not configured');
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  const res = await axios.post(url, content, { headers, timeout: 10000 });
  return res.data;
}

module.exports = { getFromRemote, putToRemote };
