const axios = require('axios');
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'https://meeting-vote-i5be.onrender.com';

async function main() {
  try {
    console.log('Target:', BASE);
    // login voter
    const login = await axios.post(`${BASE}/api/login/voter`, { name: 'Hoàng Trung Kiên', pin: '1001' }, { timeout: 5000 });
    const token = login.data && login.data.token;
    console.log('Login response:', Object.keys(login.data || {}));
    if (!token) throw new Error('No token');

    const socket = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => reject(new Error('Connect timeout')), 5000);
    });
    console.log('Connected socket');

    socket.emit('voter:vote', { choice: 'yes' });
    console.log('Emitted vote');

    await new Promise((resolve) => setTimeout(resolve, 1500));
    socket.close();
    console.log('Done');
  } catch (err) {
    console.error('Remote vote failed:', err.message || err);
    process.exit(2);
  }
}

main();
