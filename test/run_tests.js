const axios = require('axios');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'tmpdata');

async function main() {
  console.log('Running tests against', BASE);
  try {
    // login admin
    const login = await axios.post(`${BASE}/api/login/admin`, { password: ADMIN_PASSWORD });
    const token = login.data && login.data.token;
    if (!token) throw new Error('No token from admin login');
    console.log('Admin token acquired');

    // connect socket
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        console.log('Socket connected');
        resolve();
      });
      socket.on('connect_error', (err) => reject(err));
      setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    });

    // create a document
    const title = 'Test Doc ' + Date.now();
    socket.emit('admin:createDoc', { title, content: 'Automated test doc' });
    console.log('Emitted admin:createDoc');

    // wait for state event showing the doc exists
    const gotState = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No state update')), 5000);
      socket.on('state', (s) => {
        if (s && s.currentDoc && s.currentDoc.title === title) {
          clearTimeout(timer);
          resolve(s);
        }
      });
    });

    console.log('State updated, currentDoc id=', gotState.currentDoc.id);

    // give server a moment to write file
    await new Promise(r => setTimeout(r, 1000));

    const dataFile = path.join(process.cwd(), DATA_DIR, 'data.json');
    console.log('Looking for data file at', dataFile);
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf-8');
      const json = JSON.parse(raw);
      console.log('data.json loaded: documents=', (json.documents || []).length);
    } else {
      console.error('data.json NOT FOUND');
    }

    socket.close();
    console.log('Test finished');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message || err);
    process.exit(2);
  }
}

main();
