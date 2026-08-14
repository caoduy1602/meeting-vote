const axios = require('axios');
const base64 = require('base-64');

function githubApiHeaders(token) {
  return {
    Authorization: token ? `token ${token}` : undefined,
    'User-Agent': 'meeting-vote-persist',
    Accept: 'application/vnd.github.v3+json'
  };
}

async function getFileFromRepo(repo, path, branch, token) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  try {
    const res = await axios.get(url, { headers: githubApiHeaders(token) });
    if (res && res.data && res.data.content) {
      const content = base64.decode(res.data.content);
      return { content, sha: res.data.sha };
    }
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function putFileToRepo(repo, path, branch, token, content, message) {
  const getUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const putBody = {
    message: message || `Update ${path}`,
    content: base64.encode(content),
    branch
  };

  // Try to get existing file to include sha
  try {
    const existing = await axios.get(`${getUrl}?ref=${encodeURIComponent(branch)}`, { headers: githubApiHeaders(token) });
    if (existing && existing.data && existing.data.sha) {
      putBody.sha = existing.data.sha;
    }
  } catch (err) {
    if (!(err.response && err.response.status === 404)) throw err;
  }

  const res = await axios.put(getUrl, putBody, { headers: githubApiHeaders(token) });
  return res.data;
}

module.exports = {
  getFileFromRepo,
  putFileToRepo
};
