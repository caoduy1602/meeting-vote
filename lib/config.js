const fs = require('fs');
const path = require('path');

const DEFAULT_ADMIN_PASSWORD = 'admin123';

const DEFAULT_VOTERS = [
  { id: 'v1', name: 'Hoàng Trung Kiên', pin: '1001' },
  { id: 'v2', name: 'Nguyễn Tiến Đức', pin: '1002' },
  { id: 'v3', name: 'Dương Ngọc Quyết', pin: '1003' },
  { id: 'v4', name: 'Nguyễn Thị Hồng Linh', pin: '1004' },
  { id: 'v5', name: 'Phùn Ngọc Anh', pin: '1005' },
  { id: 'v6', name: 'Vũ Kim Chung', pin: '1006' },
  { id: 'v7', name: 'Chu Quốc Dân', pin: '1007' },
  { id: 'v8', name: 'Đào Văn Đông', pin: '1008' },
  { id: 'v9', name: 'Nguyễn Văn Đông', pin: '1009' },
  { id: 'v10', name: 'Nguyễn Văn Đức', pin: '1010' },
  { id: 'v11', name: 'Hà Văn Hoa', pin: '1011' },
  { id: 'v12', name: 'Nguyễn Mạnh Hùng', pin: '1012' },
  { id: 'v13', name: 'Nguyễn Thị Lan Hương', pin: '1013' },
  { id: 'v14', name: 'Nguyễn Thị Thanh Huyền', pin: '1014' },
  { id: 'v15', name: 'Phạm Quang Nghị', pin: '1015' },
  { id: 'v16', name: 'Hà Thanh Nhiễu', pin: '1016' },
  { id: 'v17', name: 'Trịnh Thị Hồng Nhung', pin: '1017' },
  { id: 'v18', name: 'Nguyễn Đức Thiện', pin: '1018' },
  { id: 'v19', name: 'Phạm Thanh Thuý', pin: '1019' },
  { id: 'v20', name: 'Nguyễn Bích Thuỷ', pin: '1020' },
  { id: 'v21', name: 'Hoàng Phi Trường', pin: '1021' },
  { id: 'v22', name: 'Bùi Văn Vượng', pin: '1022' },
  { id: 'v23', name: 'Vũ Thị Yến', pin: '1023' }
];

function getAdminPassword(env = process.env) {
  return env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

function loadVoters(votersFilePath = null) {
  const resolvedPath = votersFilePath || path.join(__dirname, '..', 'config', 'voters.json');
  const normalizedPath = path.resolve(resolvedPath);

  if (fs.existsSync(normalizedPath)) {
    try {
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (error) {
      console.warn(`[CONFIG] Không đọc được ${normalizedPath}:`, error.message);
    }
  }

  try {
    fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
    fs.writeFileSync(normalizedPath, JSON.stringify(DEFAULT_VOTERS, null, 2) + '\n', 'utf-8');
  } catch (error) {
    console.warn(`[CONFIG] Không thể ghi ${normalizedPath}:`, error.message);
  }

  return DEFAULT_VOTERS;
}

module.exports = {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_VOTERS,
  getAdminPassword,
  loadVoters
};
