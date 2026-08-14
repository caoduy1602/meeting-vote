const axios = require('axios');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const DATA_DIR = process.env.DATA_DIR || 'tmpdata';

async function main() {
  try {
    const login = await axios.post(`${BASE}/api/login/voter`, { name: 'Hoàng Trung Kiên', pin: '1001' });
    const token = login.data && login.data.token;
    if (!token) throw new Error('No token from voter login');
    console.log('Voter token acquired');

    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('Socket timeout')), 5000);
    });
    console.log('Voter socket connected');

    // Ensure currentDoc exists
    socket.emit('voter:vote', { choice: 'yes' });
    console.log('Voter voted yes');

    // wait for ack
    await new Promise((resolve) => {
      socket.on('voter:ack', () => resolve());
      setTimeout(() => resolve(), 1000);
    });

    // allow server to write
    await new Promise(r => setTimeout(r, 500));

    const dataFile = path.join(process.cwd(), DATA_DIR, 'data.json');
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf-8');
      const json = JSON.parse(raw);
      const current = json.currentDocId;
      const votes = json.votes && json.votes[current] ? json.votes[current] : {};
      console.log('Votes for current doc:', Object.keys(votes).length);
    } else {
      console.error('data.json not found');
    }

    socket.close();
    process.exit(0);
  } catch (err) {
    console.error('Voter test failed:', err.message || err);
    process.exit(2);
  }
}

main();
