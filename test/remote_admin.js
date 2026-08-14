const axios = require('axios');
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'https://meeting-vote-i5be.onrender.com';
const ADMIN_PASSWORD = process.argv[3];
if (!ADMIN_PASSWORD) {
  console.error('Usage: node remote_admin.js <baseUrl> <ADMIN_PASSWORD>');
  process.exit(2);
}

async function main() {
  try {
    console.log('Target:', BASE);
    const login = await axios.post(`${BASE}/api/login/admin`, { password: ADMIN_PASSWORD }, { timeout: 5000 });
    const token = login.data && login.data.token;
    if (!token) throw new Error('No token from admin login');
    console.log('Admin token acquired');

    const socket = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('Connect timeout')), 5000);
    });
    console.log('Socket connected');

    const title = 'AUTO_TEST_DOC_' + Date.now();
    socket.emit('admin:createDoc', { title, content: 'Created by automated test' });
    console.log('Emitted admin:createDoc ->', title);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    socket.close();

    // fetch state to confirm
    const stateRes = await axios.get(`${BASE}/api/state`, { timeout: 5000 });
    const state = stateRes.data;
    console.log('Public state currentDoc:', state.currentDoc && state.currentDoc.title);
    process.exit(0);
  } catch (err) {
    console.error('Remote admin failed:', err.message || err);
    process.exit(2);
  }
}

main();
