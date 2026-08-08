const app = document.getElementById('app');
let socket = null;
let session = null; // { token, role, name, id }
let latestState = { currentDoc: null, tally: { yes: 0, no: 0, blank: 0, total: 0 }, history: [] };
let myVoteStatus = { docId: null, voted: false, choice: null };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getYesPercent(tally) {
  const counted = tally && (tally.yes + tally.no);
  return counted > 0 ? Math.round((tally.yes / counted) * 100) : 0;
}

function formatVoteTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function saveSession(s) {
  session = s;
  localStorage.setItem('meeting-vote-session', JSON.stringify(s));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('meeting-vote-session')); } catch (e) { return null; }
}
function clearSession() {
  session = null;
  localStorage.removeItem('meeting-vote-session');
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token: session.token } });
  socket.on('connect_error', () => {
    clearSession();
    renderRoleSelect();
  });
  socket.on('state', (state) => {
    latestState = state;
    rerenderCurrentView();
  });
  if (session.role === 'voter') {
    socket.on('voter:ack', (payload) => {
      myVoteStatus = { docId: payload.docId, voted: true, choice: payload.choice };
      rerenderCurrentView();
    });
    socket.on('voter:votedStatus', (payload) => {
      myVoteStatus = payload;
      rerenderCurrentView();
    });
    socket.emit('voter:checkVoted');
  }
}

function rerenderCurrentView() {
  if (!session) return renderRoleSelect();
  if (session.role === 'admin') return renderAdmin();
  if (session.role === 'voter') return renderVoter();
  if (session.role === 'display') return renderDisplay();
}

// ---------------- ROLE SELECT ----------------
function renderRoleSelect() {
  if (socket) { socket.disconnect(); socket = null; }
  setDisplayBg(false);
  setRoleBg(true);
  setAdminBg(false);
  setVoterBg(false);
  app.innerHTML = `
    <h1 class="title">Biểu quyết Công văn</h1>
    <div class="card role-card">
      <div class="seal-mark">BQ</div>
      <div class="eyebrow">Phòng họp trực tuyến</div>
      <div class="role-sub">Chọn vai trò để tiếp tục.</div>
      <div class="role-buttons">
        <button class="btn btn-primary" id="btn-admin">Quản trị viên</button>
        <button class="btn btn-gold" id="btn-voter">Người biểu quyết</button>
        <button class="btn btn-display" id="btn-display">Màn hình kết quả (chiếu)</button>
      </div>
    </div>
    <div class="footer-note">Kết nối realtime qua WebSocket · dữ liệu lưu trên server riêng</div>
  `;
  document.getElementById('btn-admin').onclick = renderAdminLogin;
  document.getElementById('btn-voter').onclick = renderVoterLogin;
  document.getElementById('btn-display').onclick = enterDisplay;
}

function setDisplayBg(enabled) {
  try {
    if (enabled) document.body.classList.add('display-bg'); else document.body.classList.remove('display-bg');
  } catch (e) {}
}
function setRoleBg(enabled) {
  try {
    if (enabled) document.body.classList.add('role-bg'); else document.body.classList.remove('role-bg');
  } catch (e) {}
}
function setAdminBg(enabled) {
  try {
    if (enabled) document.body.classList.add('admin-bg'); else document.body.classList.remove('admin-bg');
  } catch (e) {}
}
function setVoterBg(enabled) {
  try {
    if (enabled) document.body.classList.add('voter-bg'); else document.body.classList.remove('voter-bg');
  } catch (e) {}
}

// ---------------- ADMIN LOGIN ----------------
function renderAdminLogin() {
  setRoleBg(false);
  setDisplayBg(false);
  setAdminBg(true);
  setVoterBg(false);
  app.innerHTML = `
    <div class="eyebrow">Quản trị viên</div>
    <h1 class="title">Đăng nhập quản trị</h1>
    <div class="card name-gate">
      <label>Mật khẩu quản trị</label>
      <input type="password" id="admin-pass" placeholder="••••••••">
      <div class="err" id="admin-err"></div>
      <div class="role-buttons" style="margin-top:6px">
        <button class="btn btn-primary" id="admin-submit">Đăng nhập</button>
        <button class="btn btn-ghost btn-small" id="admin-back">← Quay lại</button>
      </div>
    </div>
  `;
  document.getElementById('admin-back').onclick = renderRoleSelect;
  document.getElementById('admin-submit').onclick = async () => {
    const password = document.getElementById('admin-pass').value;
    const errEl = document.getElementById('admin-err');
    try {
      const r = await fetch('/api/login/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await r.json();
      if (!r.ok) { errEl.textContent = data.error || 'Đăng nhập thất bại'; return; }
      saveSession({ token: data.token, role: 'admin', name: data.name });
      connectSocket();
      renderAdmin();
    } catch (e) { errEl.textContent = 'Không kết nối được máy chủ'; }
  };
}

// ---------------- VOTER LOGIN ----------------
async function renderVoterLogin() {
  setDisplayBg(false);
  setRoleBg(false);
  setVoterBg(true);
  app.innerHTML = `
    <div class="eyebrow">Người biểu quyết</div>
    <h1 class="title">Xác nhận danh tính</h1>
    <div class="card name-gate">
      <label>Chọn tên của bạn</label>
      <select id="voter-name-select">
        <option value="">Đang tải danh sách...</option>
      </select>
      <label>Mã PIN</label>
      <input type="password" id="voter-pin" placeholder="••••">
      <div class="err" id="voter-err"></div>
      <div class="role-buttons" style="margin-top:6px">
        <button class="btn btn-primary" id="voter-submit">Vào phòng biểu quyết</button>
        <button class="btn btn-ghost btn-small" id="voter-back">← Quay lại</button>
      </div>
    </div>
  `;
  document.getElementById('voter-back').onclick = renderRoleSelect;

  const selectEl = document.getElementById('voter-name-select');
  const errEl = document.getElementById('voter-err');

  try {
    const r = await fetch('/api/voters');
    const voters = await r.json();
    if (!r.ok) throw new Error('load-voters-failed');
    selectEl.innerHTML = '<option value="">-- Chọn tên --</option>' + voters.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
  } catch (e) {
    selectEl.innerHTML = '<option value="">Không tải được danh sách</option>';
    errEl.textContent = 'Không tải được danh sách người biểu quyết';
  }

  document.getElementById('voter-submit').onclick = async () => {
    const voterName = selectEl.value.trim();
    const pin = document.getElementById('voter-pin').value;
    if (!voterName) { errEl.textContent = 'Vui lòng chọn tên của bạn'; return; }
    if (!pin) { errEl.textContent = 'Vui lòng nhập mã PIN'; return; }
    try {
      const r = await fetch('/api/login/voter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: voterName, pin })
      });
      const data = await r.json();
      if (!r.ok) { errEl.textContent = data.error || 'Đăng nhập thất bại'; return; }
      saveSession({ token: data.token, role: 'voter', name: data.name, id: data.id });
      connectSocket();
      renderVoter();
    } catch (e) { errEl.textContent = 'Không kết nối được máy chủ'; }
  };
}

// ---------------- DISPLAY (không cần đăng nhập, chỉ xem) ----------------
async function enterDisplay() {
  try {
    const r = await fetch('/api/state');
    latestState = await r.json();
  } catch (e) {}
  session = { role: 'display', name: 'Màn hình' };
  socket = null;
  setDisplayBg(true);
  renderDisplay();
  // dùng polling nhẹ cho màn hình chiếu vì không cần đăng nhập / token
  clearInterval(window.__displayPoll);
  window.__displayPoll = setInterval(async () => {
    try {
      const r = await fetch('/api/state');
      latestState = await r.json();
      if (session && session.role === 'display') renderDisplay();
    } catch (e) {}
  }, 2000);
}

function backToRoleSelect() {
  clearInterval(window.__displayPoll);
  clearSession();
  setDisplayBg(false);
  setRoleBg(true);
  setVoterBg(false);
  renderRoleSelect();
}

// ---------------- ADMIN VIEW ----------------
function renderAdmin() {
  setDisplayBg(false);
  setRoleBg(false);
  setAdminBg(true);
  setVoterBg(false);
  const doc = latestState.currentDoc;
  const tally = latestState.tally || { yes: 0, no: 0, blank: 0, total: 0 };
  const yesPct = getYesPercent(tally);
  const approvalText = tally.total > 0 ? `${yesPct}%` : '0%';
  const history = latestState.history || [];
  const templates = latestState.templates || [];

  app.innerHTML = `
    <div class="topbar"><span>MIỀN <span class="who">QUẢN TRỊ</span></span><span class="link-back" id="back">← Đăng xuất</span></div>
    <h1 class="title">Điều hành biểu quyết</h1>
    <div class="admin-grid">
      <div class="card panel">
        <h2>Công văn hiện tại</h2>
        <div class="desc">Nhập nội dung công văn và bấm "Đưa ra biểu quyết" — mọi người tham dự sẽ thấy ngay lập tức qua WebSocket.</div>
        <label>Tiêu đề công văn</label>
        <input type="text" id="doc-title" placeholder="Ví dụ: Công văn số 12/CV-2026 về..." ${doc && doc.status === 'open' ? 'disabled' : ''} value="${doc && doc.status === 'open' ? escapeHtml(doc.title) : ''}">
        <label>Nội dung tóm tắt (tuỳ chọn)</label>
        <textarea id="doc-content" placeholder="Tóm tắt nội dung cần xin ý kiến..." ${doc && doc.status === 'open' ? 'disabled' : ''}>${doc && doc.status === 'open' ? escapeHtml(doc.content || '') : ''}</textarea>
        <div class="doc-status-row">
          ${doc && doc.status === 'open' ? '<span class="pill open">ĐANG BIỂU QUYẾT</span>'
            : (doc && doc.status === 'closed' ? '<span class="pill closed">ĐÃ KẾT THÚC</span>' : '<span class="pill none">CHƯA CÓ CÔNG VĂN</span>')}
        </div>
        <div class="role-buttons" style="margin-top:16px">
          ${!doc || doc.status === 'closed'
            ? '<button class="btn btn-primary" id="start-vote">Đưa ra biểu quyết</button>'
            : '<button class="btn btn-gold" id="close-vote">Kết thúc &amp; chốt kết quả</button>'}
          <button class="btn btn-ghost btn-small" id="export-btn">⬇ Xuất báo cáo Excel</button>
        </div>
        <div class="template-box">
          <h3>Tài liệu đã nhập</h3>
          <div class="desc">Lưu tài liệu mẫu rồi bấm vào để tự động điền tiêu đề và nội dung khi mở biểu quyết.</div>
          <label>Tiêu đề tài liệu</label>
          <input type="text" id="template-title" placeholder="Ví dụ: Công văn số 13/CV-2026">
          <label>Nội dung tài liệu</label>
          <textarea id="template-content" placeholder="Nhập nội dung tài liệu cần lưu..."></textarea>
          <div class="role-buttons" style="max-width:none;margin:12px 0 0 0">
            <button class="btn btn-primary btn-small" id="save-template-btn">💾 Lưu tài liệu</button>
          </div>
          ${templates.length ? `<div class="template-list">${templates.map(t => `<div class="template-item"><div class="template-item-main"><div class="template-title">${escapeHtml(t.title)}</div><div class="template-content">${escapeHtml(t.content)}</div></div><div class="template-actions"><button class="btn btn-ghost btn-small use-template" data-title="${escapeHtml(t.title)}" data-content="${escapeHtml(t.content)}">Dùng</button><button class="btn btn-danger btn-small delete-template" data-template-id="${t.id}">Xóa</button></div></div>`).join('')}</div>` : '<div class="empty">Chưa có tài liệu nào được lưu.</div>'}
        </div>
        ${history.length ? `<div class="history"><h3>Lịch sử công văn</h3>${
          history.map(d => `<div class="hist-row"><span class="hist-title">${escapeHtml(d.title)}</span><span class="hist-score">${d.status === 'closed' ? `Đồng ý ${d.yes} · Không ${d.no}${d.blank !== undefined ? ` · Không bỏ phiếu ${d.blank}` : ''}` : 'Đang mở'}</span><button class="btn btn-danger btn-small delete-history-item" data-doc-id="${d.id}">Xóa</button></div>`).join('')
        }</div>` : ''}
      </div>
      <div class="card panel tally-wrap">
        <h2>Kết quả trực tiếp</h2>
        <div class="desc">${doc ? escapeHtml(doc.title) : 'Chưa có công văn nào đang biểu quyết'}</div>
        ${doc && doc.status === 'closed' ? `<div class="seal-result ${tally.yes > tally.no ? 'pass' : ''}"><div class="s1">KẾT QUẢ</div><div class="s2">${tally.yes > tally.no ? 'THÔNG QUA' : (tally.yes === tally.no ? 'HOÀ' : 'KHÔNG QUA')}</div></div>` : ''}
        <div class="tally-nums">
          <div class="tnum yes"><div class="n">${tally.yes}</div><div class="lab">Đồng ý</div></div>
          <div class="tnum no"><div class="n">${tally.no}</div><div class="lab">Không đồng ý</div></div>
          <div class="tnum blank"><div class="n">${tally.blank || 0}</div><div class="lab">Không bỏ phiếu</div></div>
        </div>
        <div class="bar"><div class="fill" style="width:${yesPct}%"></div></div>
        <div class="total-line">TỔNG SỐ PHIẾU: ${tally.total}</div>
        <div class="total-line" style="margin-top:8px;">TỶ LỆ ĐỒNG Ý: ${tally.total > 0 ? `${yesPct}%` : '0%'} trên tổng số phiếu</div>
      </div>
    </div>
  `;
  document.getElementById('back').onclick = backToRoleSelect;
  document.getElementById('export-btn').onclick = () => {
    fetch('/api/export', { headers: { Authorization: 'Bearer ' + session.token } })
      .then(r => r.ok ? r.blob() : Promise.reject(r))
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'bao-cao-bieu-quyet.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Không xuất được báo cáo'));
  };
  document.querySelectorAll('.delete-history-item').forEach(btn => {
    btn.onclick = () => {
      const docId = btn.getAttribute('data-doc-id');
      if (!docId || !confirm('Bạn có chắc muốn xóa công văn này khỏi lịch sử?')) return;
      socket.emit('admin:deleteHistoryItem', { docId });
    };
  });
  document.querySelectorAll('.use-template').forEach(btn => {
    btn.onclick = () => {
      const title = btn.getAttribute('data-title');
      const content = btn.getAttribute('data-content');
      const titleInput = document.getElementById('doc-title');
      const contentInput = document.getElementById('doc-content');
      if (titleInput) titleInput.value = title || '';
      if (contentInput) contentInput.value = content || '';
    };
  });
  document.querySelectorAll('.delete-template').forEach(btn => {
    btn.onclick = () => {
      const templateId = btn.getAttribute('data-template-id');
      if (!templateId || !confirm('Bạn có chắc muốn xóa tài liệu đã lưu này?')) return;
      socket.emit('admin:deleteTemplate', { templateId });
    };
  });
  const saveTemplateBtn = document.getElementById('save-template-btn');
  if (saveTemplateBtn) saveTemplateBtn.onclick = () => {
    const title = document.getElementById('template-title').value.trim();
    const content = document.getElementById('template-content').value.trim();
    if (!title) return alert('Vui lòng nhập tiêu đề tài liệu trước khi lưu.');
    socket.emit('admin:saveTemplate', { title, content });
    document.getElementById('template-title').value = '';
    document.getElementById('template-content').value = '';
  };
  const startBtn = document.getElementById('start-vote');
  if (startBtn) startBtn.onclick = () => {
    const title = document.getElementById('doc-title').value.trim();
    if (!title) return;
    const content = document.getElementById('doc-content').value.trim();
    socket.emit('admin:createDoc', { title, content });
  };
  const closeBtn = document.getElementById('close-vote');
  if (closeBtn) closeBtn.onclick = () => socket.emit('admin:closeDoc');
}

// ---------------- VOTER VIEW ----------------
function renderVoter() {
  setDisplayBg(false);
  setRoleBg(false);
  setVoterBg(true);
  const doc = latestState.currentDoc;

  if (!doc || doc.status !== 'open') {
    app.innerHTML = `
      <div class="topbar"><span>MIỀN <span class="who">BIỂU QUYẾT</span> · ${escapeHtml(session.name)}</span><span class="link-back" id="back">← Đăng xuất</span></div>
      <div class="voter-shell"><div class="card voter-card waiting">
        <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <p>${doc && doc.status === 'closed' ? 'Phiên biểu quyết vừa kết thúc. Đang chờ công văn tiếp theo...' : 'Đang chờ quản trị viên đưa công văn ra biểu quyết...'}</p>
      </div></div>
    `;
    document.getElementById('back').onclick = backToRoleSelect;
    return;
  }

  const votedForThisDoc = myVoteStatus.docId === doc.id && myVoteStatus.voted;

  app.innerHTML = `
    <div class="topbar"><span>MIỀN <span class="who">BIỂU QUYẾT</span> · ${escapeHtml(session.name)}</span><span class="link-back" id="back">← Đăng xuất</span></div>
    <div class="voter-shell"><div class="card voter-card">
      <div class="pill open" style="display:inline-block;margin-bottom:14px;">ĐANG BIỂU QUYẾT</div>
      <div class="voter-title">${escapeHtml(doc.title)}</div>
      ${doc.content ? `<div class="voter-content">${escapeHtml(doc.content)}</div>` : ''}
      <div id="vote-area"></div>
    </div></div>
  `;
  document.getElementById('back').onclick = backToRoleSelect;

  const area = document.getElementById('vote-area');
  const currentChoiceText = myVoteStatus.choice === 'yes' ? 'ĐỒNG Ý' : (myVoteStatus.choice === 'no' ? 'KHÔNG ĐỒNG Ý' : 'KHÔNG BỎ PHIẾU');
  const haveVote = votedForThisDoc;

  area.innerHTML = `
    ${haveVote ? `
      <div class="voted-stamp ${myVoteStatus.choice === 'yes' ? 'pass' : ''}">
        <div class="s1">ĐÃ GHI NHẬN</div>
        <div class="s2">${currentChoiceText}</div>
      </div>
      <p style="color:#6b6250;font-size:13px;">Bạn có thể đổi lựa chọn bất cứ lúc nào trước khi công văn đóng.</p>
    ` : ''}
    <div class="vote-buttons">
      <button class="vote-btn yes" id="v-yes">✓ Đồng ý</button>
      <button class="vote-btn no" id="v-no">✕ Không đồng ý</button>
      <button class="vote-btn blank" id="v-blank">○ Không bỏ phiếu</button>
    </div>
  `;
  document.getElementById('v-yes').onclick = () => socket.emit('voter:vote', { choice: 'yes' });
  document.getElementById('v-no').onclick = () => socket.emit('voter:vote', { choice: 'no' });
  document.getElementById('v-blank').onclick = () => socket.emit('voter:vote', { choice: 'blank' });
}

// ---------------- DISPLAY VIEW ----------------
function renderDisplay() {
  const doc = latestState.currentDoc;
  const tally = latestState.tally || { yes: 0, no: 0, blank: 0, total: 0 };
  const pct = getYesPercent(tally);
  const votedList = latestState.votedList || [];
  const unvotedList = latestState.unvotedList || [];
  app.innerHTML = `
    <div class="topbar"><span>MÀN HÌNH <span class="who">KẾT QUẢ</span></span><span class="link-back" id="back">← Đổi vai trò</span></div>
    <div class="display-layout">
      <div class="card panel tally-wrap" style="padding:36px;">
        <div class="display-card-title">BIỂU QUYẾT CÔNG VĂN</div>
        <h2>${doc ? escapeHtml(doc.title) : 'Chưa có công văn nào đang biểu quyết'}</h2>
        ${doc && doc.content ? `<p class="display-doc-content">${escapeHtml(doc.content)}</p>` : ''}
        <div class="desc">${doc ? (doc.status === 'open' ? 'Đang biểu quyết' : 'Đã kết thúc') : ''}</div>
        ${doc && doc.status === 'closed' ? `<div class="seal-result ${tally.yes > tally.no ? 'pass' : ''}"><div class="s1">KẾT QUẢ</div><div class="s2">${tally.yes > tally.no ? 'THÔNG QUA' : (tally.yes === tally.no ? 'HOÀ' : 'KHÔNG QUA')}</div></div>` : ''}
        <div class="tally-nums">
          <div class="tnum yes"><div class="n">${tally.yes}</div><div class="lab">Đồng ý</div></div>
          <div class="tnum no"><div class="n">${tally.no}</div><div class="lab">Không đồng ý</div></div>
          <div class="tnum blank"><div class="n">${tally.blank || 0}</div><div class="lab">Không bỏ phiếu</div></div>
        </div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        <div class="total-line">TỔNG SỐ PHIẾU: ${tally.total}</div>
        <div class="total-line" style="margin-top:8px;">TỶ LỆ ĐỒNG Ý: ${tally.total > 0 ? `${pct}%` : '0%'} trên tổng số phiếu</div>
      </div>
      <div class="display-right">
        <div class="card panel vote-list-panel">
          <h3>Danh sách đã bỏ phiếu</h3>
          <div class="vote-list">
            ${votedList.length ? votedList.map(item => `
              <div class="vote-list-item">
                <div class="vote-list-name">${escapeHtml(item.name)}</div>
                <div class="vote-list-meta">
                  <span class="vote-pill ${item.choice === 'yes' ? 'yes' : (item.choice === 'no' ? 'no' : 'blank')}">${item.choice === 'yes' ? 'Đồng ý' : (item.choice === 'no' ? 'Không đồng ý' : 'Không bỏ phiếu')}</span>
                  <span class="vote-time">${escapeHtml(formatVoteTime(item.votedAt))}</span>
                </div>
              </div>
            `).join('') : '<div class="empty">Chưa có người nào bỏ phiếu.</div>'}
          </div>
        </div>
        <div class="card panel vote-list-panel unvoted-panel">
          <h3>Danh sách chưa bỏ phiếu</h3>
          <div class="vote-list">
            ${unvotedList.length ? unvotedList.map(item => `
              <div class="vote-list-item">
                <div class="vote-list-name">${escapeHtml(item.name)}</div>
              </div>
            `).join('') : '<div class="empty">Tất cả đã tham gia bỏ phiếu.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('back').onclick = backToRoleSelect;
}

// ---------------- BOOTSTRAP ----------------
(function init() {
  const saved = loadSession();
  if (saved && saved.role !== 'display') {
    session = saved;
    connectSocket();
    rerenderCurrentView();
  } else {
    renderRoleSelect();
  }
})();
