require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const { getAdminPassword, loadVoters } = require('./lib/config');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = getAdminPassword(process.env);
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';
const DATABASE_URL = process.env.DATABASE_URL || null;

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_RENDER_DATA_DIR = path.resolve('/opt/render/project/src/data');
const REQUESTED_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const DATA_DIR = REQUESTED_DATA_DIR || (fs.existsSync(DEFAULT_RENDER_DATA_DIR) ? DEFAULT_RENDER_DATA_DIR : DEFAULT_DATA_DIR);
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const LEGACY_DATA_FILE = path.join(__dirname, 'data', 'data.json');
const VOTERS_FILE = process.env.VOTERS_FILE
  ? path.resolve(process.env.VOTERS_FILE)
  : path.join(__dirname, 'config', 'voters.json');

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

let writeJsonQueue = Promise.resolve();
function writeJsonFileAtomic(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  const tempFile = `${filePath}.${Date.now()}.tmp`;
  const backupFile = `${filePath}.bak`;

  writeJsonQueue = writeJsonQueue
    .catch(() => {})
    .then(async () => {
      console.log(`[DATA] Writing data to ${filePath}`);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      if (fs.existsSync(filePath)) {
        await fs.promises.copyFile(filePath, backupFile);
      }
      await fs.promises.writeFile(tempFile, payload, 'utf-8');
      await fs.promises.rename(tempFile, filePath);
    });

  return writeJsonQueue;
}

// ---------- Load fixed voter list ----------
let VOTERS = loadVoters(VOTERS_FILE);

// GitHub persistence config (optional)
const GITHUB_PERSIST_REPO = process.env.GITHUB_PERSIST_REPO || null; // owner/repo
const GITHUB_PERSIST_BRANCH = process.env.GITHUB_PERSIST_BRANCH || 'data-backups';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || 'data/data.json';
let githubPersist = null;
try {
  githubPersist = require('./lib/persist_github');
} catch (e) {
  githubPersist = null;
}
function normalizeVoterName(name) {
  return String(name || '').trim().toLowerCase();
}

function findVoterByName(name) {
  const targetName = normalizeVoterName(name);
  return VOTERS.find(v => normalizeVoterName(v.name) === targetName) || null;
}

// ---------- Data persistence (PostgreSQL with JSON migration from data.json) ----------
let pool = null;
let DB = {
  documents: [],
  votes: {},
  currentDocId: null,
  templates: []
};

function normalizeState(data) {
  const safeData = data && typeof data === 'object' ? data : {};
  return {
    documents: Array.isArray(safeData.documents) ? safeData.documents : [],
    votes: safeData.votes && typeof safeData.votes === 'object' ? safeData.votes : {},
    currentDocId: safeData.currentDocId ?? null,
    templates: Array.isArray(safeData.templates) ? safeData.templates : []
  };
}

function usePostgresql() {
  return Boolean(DATABASE_URL);
}

function ensureDbConfigured() {
  if (!usePostgresql()) {
    return false;
  }
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
  }
  return true;
}

async function initializeDatabase() {
  if (!usePostgresql()) {
    ensureDirectoryExists(DATA_DIR);
    return;
  }

  ensureDbConfigured();
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('[DB] Khong the ket noi PostgreSQL:', err.message);
    throw err;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_vote_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      documents JSONB NOT NULL DEFAULT '[]'::jsonb,
      votes JSONB NOT NULL DEFAULT '{}'::jsonb,
      current_doc_id TEXT,
      templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadData() {
  if (!usePostgresql()) {
    ensureDirectoryExists(DATA_DIR);

    if (!fs.existsSync(DATA_FILE)) {
      // If local data file missing, try to fetch from GitHub backup (non-blocking fallback)
      if (GITHUB_PERSIST_REPO && githubPersist && GITHUB_TOKEN) {
        try {
          console.log('[DATA] Local data missing — thử fetch từ GitHub backup');
          const remote = await githubPersist.getFileFromRepo(GITHUB_PERSIST_REPO, GITHUB_DATA_PATH, GITHUB_PERSIST_BRANCH, GITHUB_TOKEN);
          if (remote && remote.content) {
            try {
              const parsed = JSON.parse(remote.content);
              await writeJsonFileAtomic(DATA_FILE, parsed);
              console.log('[DATA] Da tai du lieu tu GitHub sang local.');
              return normalizeState(parsed);
            } catch (err) {
              console.error('[DATA] Loi khi parse noi dung GitHub:', err.message);
            }
          }
        } catch (err) {
          console.error('[DATA] Khong the fetch tu GitHub:', err.message);
        }
      }
      if (REQUESTED_DATA_DIR && REQUESTED_DATA_DIR !== DEFAULT_DATA_DIR && fs.existsSync(LEGACY_DATA_FILE)) {
        try {
          fs.copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
          console.log(`[DATA] Da copy du lieu cu tu ${LEGACY_DATA_FILE} sang ${DATA_FILE}`);
        } catch (err) {
          console.error('[DATA] Khong the copy du lieu cu:', err.message);
        }
      }

      if (!fs.existsSync(DATA_FILE)) {
        const init = normalizeState({ documents: [], votes: {}, currentDocId: null, templates: [] });
        await writeJsonFileAtomic(DATA_FILE, init);
        console.log(`[DATA] Da khoi tao file du lieu: ${DATA_FILE}`);
        return init;
      }
    }

    try {
      console.log(`[DATA] Loading data from ${DATA_FILE}`);
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      return normalizeState(data);
    } catch (err) {
      console.error('[DB] Khong the doc data.json:', err.message);
      throw err;
    }
  }

  await initializeDatabase();
  const result = await pool.query(`
    SELECT documents, votes, current_doc_id, templates
    FROM meeting_vote_state
    WHERE id = 1
  `);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return normalizeState({
      documents: row.documents || [],
      votes: row.votes || {},
      currentDocId: row.current_doc_id ?? null,
      templates: row.templates || []
    });
  }

  if (fs.existsSync(DATA_FILE)) {
    try {
      const legacyData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const imported = normalizeState(legacyData);
      await saveData(imported);
      console.log(`[DB] Da import du lieu tu ${path.relative(__dirname, DATA_FILE)} vao PostgreSQL.`);
      return imported;
    } catch (err) {
      console.error('[DB] Khong the import du lieu cu tu data.json:', err.message);
      throw err;
    }
  }

  const init = normalizeState({ documents: [], votes: {}, currentDocId: null, templates: [] });
  await saveData(init);
  return init;
}

async function saveData(data) {
  const normalized = normalizeState(data);
  if (!usePostgresql()) {
    ensureDirectoryExists(DATA_DIR);
    await writeJsonFileAtomic(DATA_FILE, normalized);
    DB = normalized;
    // Spawn async upload to GitHub if configured. Do not block main flow.
    if (GITHUB_PERSIST_REPO && githubPersist && GITHUB_TOKEN) {
      (async () => {
        try {
          const content = JSON.stringify(normalized, null, 2);
          await githubPersist.putFileToRepo(GITHUB_PERSIST_REPO, GITHUB_DATA_PATH, GITHUB_PERSIST_BRANCH, GITHUB_TOKEN, content, 'Auto backup data.json');
          console.log('[DATA] Backup data.json -> GitHub completed.');
        } catch (err) {
          console.error('[DATA] Backup to GitHub failed:', err.message);
        }
      })();
    }
    return normalized;
  }

  ensureDbConfigured();
  try {
    await pool.query(`
      INSERT INTO meeting_vote_state (id, documents, votes, current_doc_id, templates, updated_at)
      VALUES (1, $1::jsonb, $2::jsonb, $3, $4::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        documents = EXCLUDED.documents,
        votes = EXCLUDED.votes,
        current_doc_id = EXCLUDED.current_doc_id,
        templates = EXCLUDED.templates,
        updated_at = NOW()
    `, [
      JSON.stringify(normalized.documents),
      JSON.stringify(normalized.votes),
      normalized.currentDocId,
      JSON.stringify(normalized.templates)
    ]);
  } catch (err) {
    console.error('[DB] Khong the luu du lieu vao PostgreSQL:', err.message);
    throw err;
  }

  DB = normalized;
  return normalized;
}

function currentDoc() {
  if (!DB.currentDocId) return null;
  return DB.documents.find(d => d.id === DB.currentDocId) || null;
}
function normalizeVoteEntry(entry) {
  if (typeof entry === 'string') return { choice: entry, name: null, votedAt: null };
  if (entry && typeof entry === 'object' && typeof entry.choice === 'string') {
    const votedAtValue = entry.votedAt || entry.timestamp || null;
    return { choice: entry.choice, name: entry.name || null, votedAt: votedAtValue ? Number(votedAtValue) : null };
  }
  return { choice: null, name: null, votedAt: null };
}
function tallyFor(docId) {
  const v = DB.votes[docId] || {};
  const yes = Object.values(v).filter(x => normalizeVoteEntry(x).choice === 'yes').length;
  const no = Object.values(v).filter(x => normalizeVoteEntry(x).choice === 'no').length;
  const blank = Object.values(v).filter(x => normalizeVoteEntry(x).choice === 'blank').length;
  return { yes, no, blank, total: yes + no + blank };
}
function yesPercent(tally) {
  if (!tally) return 0;
  const counted = tally.yes + tally.no;
  return counted > 0 ? (tally.yes / counted) : 0;
}
function publicState() {
  const doc = currentDoc();
  const currentVotes = doc ? (DB.votes[doc.id] || {}) : {};
  const votedList = Object.entries(currentVotes)
    .map(([voterId, entry]) => {
      const normalized = normalizeVoteEntry(entry);
      const voter = VOTERS.find(v => v.id === voterId);
      return {
        id: voterId,
        name: normalized.name || (voter ? voter.name : voterId),
        choice: normalized.choice,
        votedAt: normalized.votedAt
      };
    })
    .filter(item => item.choice)
    .sort((a, b) => (a.votedAt || 0) - (b.votedAt || 0));
  const unvotedList = VOTERS
    .filter(voter => {
      if (!doc) return true; // nếu chưa có công văn thì vẫn hiện toàn bộ danh sách
      const entry = currentVotes[voter.id];
      return !entry || !normalizeVoteEntry(entry).choice;
    })
    .map(voter => ({ id: voter.id, name: voter.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return {
    currentDoc: doc,
    tally: doc ? tallyFor(doc.id) : { yes: 0, no: 0, blank: 0, total: 0 },
    totalVoters: VOTERS.length,
    votedList,
    unvotedList,
    history: DB.documents.map(d => ({
      id: d.id, title: d.title, status: d.status,
      yes: d.status === 'closed' ? d.yes : undefined,
      no: d.status === 'closed' ? d.no : undefined,
      blank: d.status === 'closed' ? d.blank : undefined,
      createdAt: d.createdAt
    })),
    templates: (DB.templates || []).map(t => ({ id: t.id, title: t.title, content: t.content, createdAt: t.createdAt }))
  };
}

// ---------- Express app ----------
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function signToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '12h' });
}
function verifyToken(token) {
  try { return jwt.verify(token, SESSION_SECRET); } catch (e) { return null; }
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Khong co quyen truy cap' });
  req.user = payload;
  next();
}

// Danh sách tên hiển thị cho màn hình chọn người biểu quyết (không lộ pin)
app.get('/api/voters', (req, res) => {
  res.json(VOTERS.map(v => ({ id: v.id, name: v.name })));
});

// Đăng nhập admin
app.post('/api/login/admin', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Sai mat khau' });
  const token = signToken({ role: 'admin' });
  res.json({ token, name: 'Quản trị viên' });
});

// Đăng nhập người biểu quyết bằng tên đã chọn và mã PIN
app.post('/api/login/voter', (req, res) => {
  const { name, pin } = req.body || {};
  const trimmedName = String(name || '').trim();
  const trimmedPin = String(pin || '').trim();

  if (!trimmedName) return res.status(400).json({ error: 'Vui lòng chọn tên của bạn' });

  const voter = findVoterByName(trimmedName);
  if (!voter) {
    return res.status(401).json({ error: 'Tên không có trong danh sách người biểu quyết' });
  }

  if (String(voter.pin || '') !== trimmedPin) {
    return res.status(401).json({ error: 'Mã PIN không đúng' });
  }

  const token = signToken({ role: 'voter', id: voter.id, name: voter.name });
  res.json({ token, name: voter.name, id: voter.id });
});

// Trạng thái hiện tại (dùng cho tải trang lần đầu / màn hình chiếu không cần đăng nhập)
app.get('/api/state', (req, res) => res.json(publicState()));

// Xuất báo cáo toàn bộ các công văn đã/đang biểu quyết ra Excel — chỉ admin
app.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Meeting Vote';
    wb.created = new Date();

    const summary = wb.addWorksheet('Tổng hợp');
    const summaryHeaders = [
      'Công văn',
      'Trạng thái',
      'Đồng ý',
      'Không đồng ý',
      'Phiếu trắng',
      'Tổng phiếu',
      'Tỷ lệ đồng ý (%)',
      'Kết quả'
    ];
    summary.columns = [
      { header: summaryHeaders[0], key: 'title', width: 40 },
      { header: summaryHeaders[1], key: 'status', width: 15 },
      { header: summaryHeaders[2], key: 'yes', width: 10 },
      { header: summaryHeaders[3], key: 'no', width: 14 },
      { header: summaryHeaders[4], key: 'blank', width: 12 },
      { header: summaryHeaders[5], key: 'total', width: 12 },
      { header: summaryHeaders[6], key: 'yesPercent', width: 16 },
      { header: summaryHeaders[7], key: 'result', width: 15 },
    ];

    const summaryRows = [];
    for (const d of DB.documents) {
      const t = tallyFor(d.id);
      const approvalPercent = yesPercent(t);
      let result = '—';
      if (d.status === 'closed') result = t.yes > t.no ? 'Thông qua' : (t.yes === t.no ? 'Hoà' : 'Không qua');
      summaryRows.push({
        title: d.title,
        status: d.status === 'open' ? 'Đang mở' : 'Đã đóng',
        yes: t.yes,
        no: t.no,
        blank: t.blank,
        total: t.total,
        yesPercent: `${(approvalPercent * 100).toFixed(0)}%`,
        result
      });

      const baseSheetName = String(d.title || d.id).replace(/[\\/*?:\[\]]/g, '').slice(0, 24) || d.id;
      const sheetName = baseSheetName.length > 31 ? baseSheetName.slice(0, 31) : baseSheetName;
      const existingNames = new Set(wb.worksheets.map(ws => ws.name));
      let finalSheetName = sheetName;
      let suffix = 2;
      while (existingNames.has(finalSheetName)) {
        finalSheetName = `${sheetName.slice(0, 31 - String(suffix).length - 1)}_${suffix}`;
        suffix += 1;
      }
      existingNames.add(finalSheetName);
      const sheet = wb.addWorksheet(finalSheetName);
      sheet.columns = [
        { header: 'Người biểu quyết', key: 'name', width: 28 },
        { header: 'Lựa chọn', key: 'choice', width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };
      const votes = DB.votes[d.id] || {};
      const voterIds = Array.from(new Set([...VOTERS.map(v => v.id), ...Object.keys(votes)]));
      for (const voterId of voterIds) {
        const voter = VOTERS.find(v => v.id === voterId);
        const voteEntry = votes[voterId];
        const normalizedVote = normalizeVoteEntry(voteEntry);
        const choice = normalizedVote.choice;
        sheet.addRow({
          name: normalizedVote.name || (voter ? voter.name : voterId),
          choice: choice === 'yes' ? 'Đồng ý' : (choice === 'no' ? 'Không đồng ý' : (choice === 'blank' ? 'Phiếu trắng' : 'Chưa bỏ phiếu'))
        });
      }
    }

    summary.getRow(1).values = summaryHeaders;
    summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
    summary.addRows(summaryRows);
    if (summary.rowCount < 2) {
      summary.addRow({ title: '', status: '', yes: '', no: '', blank: '', total: '', yesPercent: '', result: '' });
    }
    summary.eachRow((row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          right: { style: 'thin', color: { argb: 'FFBDBDBD' } }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-bieu-quyet.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[EXPORT] Không thể tạo file Excel:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Không thể tạo file Excel' });
    }
  }
});

// ---------- Admin: trigger immediate backup (synchronous) ----------
app.post('/api/admin/backup', requireAdmin, async (req, res) => {
  try {
    // Ensure local file is up-to-date
    await writeJsonFileAtomic(DATA_FILE, DB);

    // If GitHub persistence is configured, push the file and wait for completion
    if (GITHUB_PERSIST_REPO && githubPersist && GITHUB_TOKEN) {
      try {
        const content = JSON.stringify(DB, null, 2);
        await githubPersist.putFileToRepo(GITHUB_PERSIST_REPO, GITHUB_DATA_PATH, GITHUB_PERSIST_BRANCH, GITHUB_TOKEN, content, 'Manual backup data.json');
        return res.json({ ok: true, github: true });
      } catch (err) {
        console.error('[ADMIN-BACKUP] Backup to GitHub failed:', err.message);
        return res.status(500).json({ ok: false, error: 'GitHub backup failed', detail: err.message });
      }
    }

    return res.json({ ok: true, github: false });
  } catch (err) {
    console.error('[ADMIN-BACKUP] Error during backup:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Socket.IO auth middleware ----------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = token && verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.data.user = payload;
  next();
});

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  // ----- Admin: tạo công văn mới, mở biểu quyết -----
  socket.on('admin:createDoc', async (payload) => {
    if (socket.data.user.role !== 'admin') return;
    const title = String(payload && payload.title || '').trim();
    if (!title) return;
    const content = String(payload && payload.content || '').trim();
    const id = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const doc = { id, title, content, status: 'open', createdAt: Date.now(), yes: 0, no: 0, blank: 0 };
    DB.documents.unshift(doc);
    DB.votes[id] = {};
    DB.currentDocId = id;
    await saveData(DB);
    io.emit('state', publicState());
  });

  // ----- Admin: đóng biểu quyết, chốt kết quả -----
  socket.on('admin:closeDoc', async () => {
    if (socket.data.user.role !== 'admin') return;
    const doc = currentDoc();
    if (!doc || doc.status !== 'open') return;
    const t = tallyFor(doc.id);
    doc.status = 'closed';
    doc.closedAt = Date.now();
    doc.yes = t.yes;
    doc.no = t.no;
    doc.blank = t.blank;
    await saveData(DB);
    io.emit('state', publicState());
  });

  // ----- Admin: lưu tài liệu mẫu cho lần biểu quyết sau -----
  socket.on('admin:saveTemplate', async (payload) => {
    if (socket.data.user.role !== 'admin') return;
    const title = String(payload && payload.title || '').trim();
    const content = String(payload && payload.content || '').trim();
    if (!title) return;
    if (!DB.templates) DB.templates = [];
    const exists = DB.templates.find(t => t.title === title && t.content === content);
    if (!exists) {
      DB.templates.unshift({ id: 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, content, createdAt: Date.now() });
      await saveData(DB);
    }
    io.emit('state', publicState());
  });

  // ----- Admin: xóa một mục lịch sử công văn -----
  socket.on('admin:deleteHistoryItem', async (payload) => {
    if (socket.data.user.role !== 'admin') return;
    const docId = String(payload && payload.docId || '').trim();
    if (!docId) return;
    const idx = DB.documents.findIndex(d => d.id === docId);
    if (idx === -1) return;
    DB.documents.splice(idx, 1);
    if (DB.votes[docId]) delete DB.votes[docId];
    if (DB.currentDocId === docId) DB.currentDocId = null;
    await saveData(DB);
    io.emit('state', publicState());
  });

  // ----- Admin: xóa một tài liệu đã lưu -----
  socket.on('admin:deleteTemplate', async (payload) => {
    if (socket.data.user.role !== 'admin') return;
    const templateId = String(payload && payload.templateId || '').trim();
    if (!templateId) return;
    if (!DB.templates) DB.templates = [];
    DB.templates = DB.templates.filter(t => t.id !== templateId);
    await saveData(DB);
    io.emit('state', publicState());
  });

  // ----- Voter: bỏ phiếu -----
  socket.on('voter:vote', async (payload) => {
    if (socket.data.user.role !== 'voter') return;
    const doc = currentDoc();
    if (!doc || doc.status !== 'open') return;
    const choice = payload && payload.choice;
    if (choice !== 'yes' && choice !== 'no' && choice !== 'blank') return;
    const voterId = socket.data.user.id;
    const voterName = socket.data.user.name;
    if (!DB.votes[doc.id]) DB.votes[doc.id] = {};
    // mỗi người chỉ được tính 1 phiếu cho mỗi công văn (ghi đè nếu đổi ý trước khi đóng)
    DB.votes[doc.id][voterId] = { choice, name: voterName, votedAt: Date.now() };
    await saveData(DB);
    io.emit('state', publicState());
    socket.emit('voter:ack', { docId: doc.id, choice });
  });

  // Cho voter biết họ đã bầu công văn hiện tại chưa, khi vừa kết nối lại
  socket.on('voter:checkVoted', () => {
    if (socket.data.user.role !== 'voter') return;
    const doc = currentDoc();
    if (!doc) return socket.emit('voter:votedStatus', { docId: null, voted: false });
    const v = DB.votes[doc.id] || {};
    const mine = v[socket.data.user.id];
    const normalizedMine = normalizeVoteEntry(mine);
    socket.emit('voter:votedStatus', { docId: doc.id, voted: !!mine, choice: normalizedMine.choice || null });
  });
});

async function startServer() {
  try {
    DB = await loadData();
    server.listen(PORT, () => {
      console.log(`Meeting-vote server dang chay tai http://localhost:${PORT}`);
    console.log(`[DATA] Su dung DATA_DIR: ${DATA_DIR}`);
    if (usePostgresql()) {
      console.log('[DB] Dang su dung PostgreSQL.');
    } else {
      console.log('[DB] Chua co DATABASE_URL, dang su dung fallback data.json cho local development.');
    }
    if (VOTERS.length === 0) {
      console.log('>> Hay tao file config/voters.json (copy tu voters.example.json) truoc khi dung that.');
    }
  });
  } catch (error) {
    console.error('[DB] Khong the khoi dong server:', error.message);
    process.exit(1);
  }
}

startServer();
