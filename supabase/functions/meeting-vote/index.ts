import postgres from 'npm:postgres@3.4.7';
import ExcelJS from 'npm:exceljs@4.4.0';

const encoder = new TextEncoder();
const databaseUrl = Deno.env.get('SUPABASE_DB_URL') || '';
const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const publishableKey = publishableKeys.default || Deno.env.get('SUPABASE_ANON_KEY') || '';
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const adminPassword = Deno.env.get('ADMIN_PASSWORD') || '';
const sessionSecret = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const database = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Meeting-Vote-Site-Proxy'
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function base64UrlEncode(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey() {
  if (!sessionSecret) throw new HttpError(503, 'Chưa có Supabase secret key');
  return crypto.subtle.importKey(
    'raw', encoder.encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function signToken(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify({ ...payload, iat: now, exp: now + 43200 })));
  const unsigned = `${header}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(unsigned)));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function verifyToken(token: string) {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(), base64UrlDecode(signature), encoder.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    if (!payload.exp || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireRole(request: Request, role: 'admin' | 'voter') {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== role) throw new HttpError(401, 'Không có quyền truy cập');
  return payload;
}

function hexToBytes(value: string) {
  return Uint8Array.from(value.match(/.{1,2}/g) || [], byte => Number.parseInt(byte, 16));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bytes = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: hexToBytes(salt), iterations: 210000, hash: 'SHA-256'
  }, key, 256));
  return bytesToHex(bytes);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function normalizeVoterName(name: unknown) {
  return String(name || '').trim().toLocaleLowerCase('vi');
}

function normalizeState(data: Record<string, unknown> = {}) {
  return {
    documents: Array.isArray(data.documents) ? data.documents : [],
    votes: data.votes && typeof data.votes === 'object' ? data.votes as Record<string, Record<string, unknown>> : {},
    currentDocId: typeof data.current_doc_id === 'string' ? data.current_doc_id : (data.currentDocId ?? null),
    templates: Array.isArray(data.templates) ? data.templates : []
  };
}

function normalizeVoteEntry(entry: unknown) {
  if (typeof entry === 'string') return { choice: entry, name: null, votedAt: null };
  if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).choice === 'string') {
    const value = entry as Record<string, unknown>;
    const votedAt = value.votedAt || value.timestamp || null;
    return {
      choice: value.choice as string,
      name: value.name ? String(value.name) : null,
      votedAt: votedAt ? Number(votedAt) : null
    };
  }
  return { choice: null, name: null, votedAt: null };
}

function currentDoc(state: ReturnType<typeof normalizeState>) {
  return state.currentDocId
    ? state.documents.find((document: Record<string, unknown>) => document.id === state.currentDocId) || null
    : null;
}

function tallyFor(state: ReturnType<typeof normalizeState>, docId: string) {
  const votes = state.votes[docId] || {};
  const choices = Object.values(votes).map(entry => normalizeVoteEntry(entry).choice);
  const yes = choices.filter(choice => choice === 'yes').length;
  const no = choices.filter(choice => choice === 'no').length;
  const blank = choices.filter(choice => choice === 'blank').length;
  return { yes, no, blank, total: yes + no + blank };
}

function publicState(state: ReturnType<typeof normalizeState>, voters: Array<Record<string, unknown>>) {
  const doc = currentDoc(state);
  const currentVotes = doc ? (state.votes[String(doc.id)] || {}) : {};
  const votedList = Object.entries(currentVotes)
    .map(([voterId, entry]) => {
      const normalized = normalizeVoteEntry(entry);
      const voter = voters.find(item => item.id === voterId);
      return {
        id: voterId,
        name: normalized.name || (voter ? voter.name : voterId),
        choice: normalized.choice,
        votedAt: normalized.votedAt
      };
    })
    .filter(item => item.choice)
    .sort((a, b) => Number(a.votedAt || 0) - Number(b.votedAt || 0));
  const unvotedList = voters
    .filter(voter => !doc || !normalizeVoteEntry(currentVotes[String(voter.id)]).choice)
    .map(voter => ({ id: voter.id, name: voter.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));

  return {
    currentDoc: doc,
    tally: doc ? tallyFor(state, String(doc.id)) : { yes: 0, no: 0, blank: 0, total: 0 },
    totalVoters: voters.length,
    votedList,
    unvotedList,
    history: state.documents.map((document: Record<string, unknown>) => ({
      id: document.id,
      title: document.title,
      status: document.status,
      yes: document.status === 'closed' ? document.yes : undefined,
      no: document.status === 'closed' ? document.no : undefined,
      blank: document.status === 'closed' ? document.blank : undefined,
      createdAt: document.createdAt
    })),
    templates: state.templates.map((template: Record<string, unknown>) => ({
      id: template.id,
      title: template.title,
      content: template.content,
      createdAt: template.createdAt
    }))
  };
}

function voterStatus(state: ReturnType<typeof normalizeState>, voterId: string) {
  const doc = currentDoc(state);
  if (!doc) return { docId: null, voted: false, choice: null };
  const entry = (state.votes[String(doc.id)] || {})[voterId];
  const choice = normalizeVoteEntry(entry).choice;
  return { docId: doc.id, voted: Boolean(entry), choice: choice || null };
}

async function withConnection<T>(callback: (connection: any) => Promise<T>): Promise<T> {
  if (!database) throw new HttpError(503, 'Chưa cấu hình SUPABASE_DB_URL');
  const connection = {
    queryObject(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.reduce((result, part, index) => `${result}${index ? `$${index}` : ''}${part}`, '');
      return database.unsafe(query, values as never[]).then(rows => ({ rows }));
    },
    release() {}
  };
  return callback(connection);
}

async function readState(connection: any) {
  const result = await connection.queryObject`SELECT documents, votes, current_doc_id, templates, version FROM public.meeting_vote_state WHERE id = 1`;
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(503, 'Chưa khởi tạo meeting_vote_state');
  return {
    state: normalizeState(row),
    version: Number(row.version || 1)
  };
}

async function readVoters(connection: any) {
  const result = await connection.queryObject`SELECT id, name, pin_salt, pin_hash FROM public.meeting_vote_voters ORDER BY id`;
  return result.rows as Array<Record<string, unknown>>;
}

function applyMutation(
  state: ReturnType<typeof normalizeState>,
  action: string,
  payload: Record<string, unknown>,
  user: Record<string, unknown>,
  voters: Array<Record<string, unknown>>
) {
  if (action === 'create-doc') {
    const title = String(payload.title || '').trim();
    if (!title) throw new HttpError(400, 'Vui lòng nhập tiêu đề công văn');
    const now = Date.now();
    const id = `d_${now.toString(36)}${crypto.randomUUID().slice(0, 4)}`;
    state.documents.unshift({
      id,
      title,
      content: String(payload.content || '').trim(),
      status: 'open',
      createdAt: now,
      startedAt: now,
      yes: 0,
      no: 0,
      blank: 0
    });
    state.votes[id] = {};
    state.currentDocId = id;
    return {};
  }

  if (action === 'close-doc') {
    const doc = currentDoc(state);
    if (!doc || doc.status !== 'open') throw new HttpError(409, 'Không có phiên biểu quyết đang mở');
    const tally = tallyFor(state, String(doc.id));
    doc.status = 'closed';
    doc.closedAt = Date.now();
    doc.yes = tally.yes;
    doc.no = tally.no;
    doc.blank = tally.blank;
    return {};
  }

  if (action === 'reset') {
    state.currentDocId = null;
    return {};
  }

  if (action === 'save-template') {
    const title = String(payload.title || '').trim();
    const content = String(payload.content || '').trim();
    if (!title) throw new HttpError(400, 'Vui lòng nhập tiêu đề tài liệu');
    const exists = state.templates.some((template: Record<string, unknown>) => template.title === title && template.content === content);
    if (!exists) {
      state.templates.unshift({
        id: `tpl_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`,
        title,
        content,
        createdAt: Date.now()
      });
    }
    return {};
  }

  if (action === 'delete-history') {
    const docId = String(payload.docId || '').trim();
    if (!docId) throw new HttpError(400, 'Thiếu mã công văn');
    const index = state.documents.findIndex((document: Record<string, unknown>) => document.id === docId);
    if (index < 0) throw new HttpError(404, 'Không tìm thấy công văn');
    state.documents.splice(index, 1);
    delete state.votes[docId];
    if (state.currentDocId === docId) state.currentDocId = null;
    return {};
  }

  if (action === 'delete-template') {
    const templateId = String(payload.templateId || '').trim();
    if (!templateId) throw new HttpError(400, 'Thiếu mã tài liệu');
    state.templates = state.templates.filter((template: Record<string, unknown>) => template.id !== templateId);
    return {};
  }

  if (action === 'vote') {
    const doc = currentDoc(state);
    const choice = payload.choice;
    if (!doc || doc.status !== 'open') throw new HttpError(409, 'Phiên biểu quyết không còn mở');
    if (!['yes', 'no', 'blank'].includes(String(choice))) throw new HttpError(400, 'Lựa chọn không hợp lệ');
    const voterId = String(user.id);
    if (!voters.some(voter => voter.id === voterId)) throw new HttpError(403, 'Người biểu quyết không còn trong danh sách');
    if (!state.votes[String(doc.id)]) state.votes[String(doc.id)] = {};
    state.votes[String(doc.id)][voterId] = {
      choice,
      name: user.name,
      votedAt: Date.now()
    };
    return { voterStatus: voterStatus(state, voterId) };
  }

  throw new HttpError(404, 'Không tìm thấy thao tác');
}

async function broadcastState() {
  if (!supabaseUrl || !publishableKey) return;
  try {
    const response = await fetch(
      `${supabaseUrl}/realtime/v1/api/broadcast/meeting-vote-state/events/state`,
      {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ changedAt: Date.now() })
      }
    );
    if (!response.ok) console.error('[Realtime] Broadcast failed:', response.status);
  } catch (error) {
    console.error('[Realtime] Broadcast failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

function siteContentType(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    css: 'text/css; charset=utf-8',
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp'
  };
  return contentTypes[extension || ''] || 'application/octet-stream';
}

async function serveSite(route: string) {
  const requestedPath = route === '/site' || route === '/site/'
    ? 'index.html'
    : route.slice('/site/'.length);
  const segments = requestedPath.split('/');
  if (!requestedPath || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new HttpError(404, 'Không tìm thấy tệp');
  }
  const objectPath = segments.map(encodeURIComponent).join('/');
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/public/meeting-vote-site/${objectPath}`
  );
  if (!response.ok) throw new HttpError(404, 'Không tìm thấy tệp');
  const body = requestedPath.toLowerCase().endsWith('.html')
    ? await response.text()
    : await response.arrayBuffer();
  return new Response(body, {
    headers: {
      ...corsHeaders,
      'Content-Type': requestedPath.toLowerCase().endsWith('.html') ? 'text/html' : siteContentType(requestedPath),
      'X-Meeting-Vote-Site-Proxy': siteContentType(requestedPath),
      'Cache-Control': 'public, max-age=60'
    }
  });
}

async function mutate(action: string, payload: Record<string, unknown>, user: Record<string, unknown>) {
  return withConnection(async connection => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { state, version } = await readState(connection);
      const voters = await readVoters(connection);
      const extra = applyMutation(state, action, payload, user, voters);
      const update = await connection.queryObject`
        UPDATE public.meeting_vote_state
        SET documents = ${JSON.stringify(state.documents)}::jsonb,
            votes = ${JSON.stringify(state.votes)}::jsonb,
            current_doc_id = ${state.currentDocId},
            templates = ${JSON.stringify(state.templates)}::jsonb,
            version = version + 1,
            updated_at = NOW()
        WHERE id = 1 AND version = ${version}
        RETURNING version
      `;
      if (!update.rows.length) continue;
      const result = { state: publicState(state, voters), ...extra };
      await broadcastState();
      return result;
    }
    throw new HttpError(409, 'Dữ liệu vừa được cập nhật, vui lòng thử lại');
  });
}

async function createExport() {
  return withConnection(async connection => {
    const { state } = await readState(connection);
    const voters = await readVoters(connection);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Meeting Vote';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Tổng hợp');
    const headers = ['Công văn', 'Trạng thái', 'Đồng ý', 'Không đồng ý', 'Phiếu trắng', 'Tổng phiếu', 'Tỷ lệ đồng ý (%)', 'Kết quả'];
    summary.columns = [
      { header: headers[0], key: 'title', width: 40 },
      { header: headers[1], key: 'status', width: 15 },
      { header: headers[2], key: 'yes', width: 10 },
      { header: headers[3], key: 'no', width: 14 },
      { header: headers[4], key: 'blank', width: 12 },
      { header: headers[5], key: 'total', width: 12 },
      { header: headers[6], key: 'yesPercent', width: 16 },
      { header: headers[7], key: 'result', width: 15 }
    ];

    const summaryRows = [];
    for (const doc of state.documents as Array<Record<string, unknown>>) {
      const tally = tallyFor(state, String(doc.id));
      const approvalPercent = tally.yes + tally.no > 0 ? tally.yes / (tally.yes + tally.no) : 0;
      const result = doc.status !== 'closed' ? '—' : (tally.yes > tally.no ? 'Thông qua' : (tally.yes === tally.no ? 'Hoà' : 'Không qua'));
      summaryRows.push({
        title: doc.title,
        status: doc.status === 'open' ? 'Đang mở' : 'Đã đóng',
        yes: tally.yes,
        no: tally.no,
        blank: tally.blank,
        total: tally.total,
        yesPercent: `${(approvalPercent * 100).toFixed(0)}%`,
        result
      });

      const baseName = String(doc.title || doc.id).replace(/[\\/*?:\[\]]/g, '').slice(0, 24) || String(doc.id);
      const existingNames = new Set(workbook.worksheets.map(sheet => sheet.name));
      let sheetName = baseName;
      let suffix = 2;
      while (existingNames.has(sheetName)) {
        sheetName = `${baseName.slice(0, 31 - String(suffix).length - 1)}_${suffix}`;
        suffix += 1;
      }
      const sheet = workbook.addWorksheet(sheetName);
      sheet.columns = [{ header: 'Người biểu quyết', key: 'name', width: 28 }, { header: 'Lựa chọn', key: 'choice', width: 20 }];
      sheet.getRow(1).font = { bold: true };
      const votes = state.votes[String(doc.id)] || {};
      const voterIds = Array.from(new Set([...voters.map(voter => String(voter.id)), ...Object.keys(votes)]));
      for (const voterId of voterIds) {
        const voter = voters.find(item => item.id === voterId);
        const normalized = normalizeVoteEntry(votes[voterId]);
        const choice = normalized.choice;
        sheet.addRow({
          name: normalized.name || (voter ? voter.name : voterId),
          choice: choice === 'yes' ? 'Đồng ý' : (choice === 'no' ? 'Không đồng ý' : (choice === 'blank' ? 'Phiếu trắng' : 'Chưa bỏ phiếu'))
        });
      }
    }

    summary.getRow(1).values = headers;
    summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
    summary.addRows(summaryRows);
    if (summary.rowCount < 2) summary.addRow({ title: '', status: '', yes: '', no: '', blank: '', total: '', yesPercent: '', result: '' });
    summary.eachRow((row: any) => row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
        left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
        bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
        right: { style: 'thin', color: { argb: 'FFBDBDBD' } }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }));

    const file = await workbook.xlsx.writeBuffer();
    return new Response(file, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="bao-cao-bieu-quyet.xlsx"'
      }
    });
  });
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const pathname = new URL(request.url).pathname;
  const marker = '/meeting-vote';
  const markerIndex = pathname.indexOf(marker);
  const route = markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname;
  const payload = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (request.method === 'GET' && (route === '/site' || route.startsWith('/site/'))) {
    return serveSite(route);
  }

  if (request.method === 'GET' && route === '/api/voters') {
    return withConnection(async connection => {
      const voters = await readVoters(connection);
      return jsonResponse(voters.map(voter => ({ id: voter.id, name: voter.name })));
    });
  }

  if (request.method === 'POST' && route === '/api/login/admin') {
    if (!adminPassword) throw new HttpError(503, 'Chưa cấu hình ADMIN_PASSWORD');
    if (!payload || typeof payload.password !== 'string' || payload.password !== adminPassword) {
      throw new HttpError(401, 'Sai mật khẩu');
    }
    return jsonResponse({ token: await signToken({ role: 'admin' }), name: 'Quản trị viên' });
  }

  if (request.method === 'POST' && route === '/api/login/voter') {
    const name = String(payload?.name || '').trim();
    const pin = String(payload?.pin || '').trim();
    if (!name) throw new HttpError(400, 'Vui lòng chọn tên của bạn');
    return withConnection(async connection => {
      const voters = await readVoters(connection);
      const voter = voters.find(item => normalizeVoterName(item.name) === normalizeVoterName(name));
      if (!voter) throw new HttpError(401, 'Tên không có trong danh sách người biểu quyết');
      if (!constantTimeEqual(await hashPin(pin, String(voter.pin_salt)), String(voter.pin_hash))) {
        throw new HttpError(401, 'Mã PIN không đúng');
      }
      return jsonResponse({
        token: await signToken({ role: 'voter', id: voter.id, name: voter.name }),
        name: voter.name,
        id: voter.id
      });
    });
  }

  if (request.method === 'GET' && route === '/api/state') {
    return withConnection(async connection => {
      const { state } = await readState(connection);
      const voters = await readVoters(connection);
      return jsonResponse(publicState(state, voters));
    });
  }

  if (request.method === 'GET' && route === '/api/voter/status') {
    const user = await requireRole(request, 'voter');
    return withConnection(async connection => {
      const { state } = await readState(connection);
      return jsonResponse(voterStatus(state, String(user.id)));
    });
  }

  if (request.method === 'GET' && route === '/api/export') {
    await requireRole(request, 'admin');
    return createExport();
  }

  if (request.method === 'POST') {
    const actions: Record<string, { action: string; role: 'admin' | 'voter' }> = {
      '/api/admin/create-doc': { action: 'create-doc', role: 'admin' },
      '/api/admin/close-doc': { action: 'close-doc', role: 'admin' },
      '/api/admin/reset': { action: 'reset', role: 'admin' },
      '/api/admin/save-template': { action: 'save-template', role: 'admin' },
      '/api/admin/delete-history': { action: 'delete-history', role: 'admin' },
      '/api/admin/delete-template': { action: 'delete-template', role: 'admin' },
      '/api/voter/vote': { action: 'vote', role: 'voter' }
    };
    const configuredAction = actions[route];
    if (!configuredAction) throw new HttpError(404, 'Không tìm thấy đường dẫn');
    const user = await requireRole(request, configuredAction.role);
    const result = await mutate(configuredAction.action, payload || {}, user);
    return jsonResponse(result);
  }

  throw new HttpError(404, 'Không tìm thấy đường dẫn');
}

Deno.serve(async request => {
  try {
    return await handleRequest(request);
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ error: error.message }, error.status);
    console.error('[Edge Function] Request failed:', error instanceof Error ? error.message : 'unknown error');
    return jsonResponse({ error: 'Không thể xử lý yêu cầu' }, 500);
  }
});