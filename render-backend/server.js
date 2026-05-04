import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';

const app = express();
const port = Number(process.env.PORT || 10000);
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://todotrails.vercel.app';

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({ origin: allowedOrigin.split(',').map((origin) => origin.trim()) }));
app.use('/uploads', express.static(uploadDir, {
  immutable: true,
  maxAge: '365d',
}));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads allowed.'));
      return;
    }
    cb(null, true);
  },
});

function requestBaseUrl(req) {
  if (publicBaseUrl) return publicBaseUrl;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/uploads', upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Image required.' });
    return;
  }

  const url = `${requestBaseUrl(req)}/uploads/${req.file.filename}`;
  res.json({
    id: path.parse(req.file.filename).name,
    url,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size,
  });
});

app.use((error, _req, res, _next) => {
  void _next;
  res.status(400).json({ error: error instanceof Error ? error.message : 'Upload failed.' });
});

app.listen(port, () => {
  console.log(`TodoTrails attachment server listening on ${port}`);
});
