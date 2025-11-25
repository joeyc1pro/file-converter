/**
 * server.js
 * Simple file-converter web app
 *
 * Requirements (system):
 *   - ffmpeg (installed and on PATH) -> for audio/video
 *   - libreoffice (installed and on PATH) -> for Office <-> PDF conversions
 *
 * Install:
 *   npm install
 *   node server.js
 *
 * WARNING: This example allows large uploads if configured; DO NOT use in production
 * without auth, quotas, virus scanning and monitoring.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const cors = require('cors');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const libre = require('libreoffice-convert');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

const app = express();
app.use(morgan('tiny'));
app.use(cors());
app.use(express.static('public'));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUT_DIR = path.join(__dirname, 'out');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// ========== CONFIG ==========
/*
 * MAX_FILE_BYTES: set to a very large number for "no limits".
 * Be careful — this allows huge uploads that can break the server.
 * You may set to Number.MAX_SAFE_INTEGER or a large integer like 10 * 1024 * 1024 * 1024 (10GB)
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB by default — change as desired

// Multer storage (disk)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || '';
    cb(null, id + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES } // adjust/remove for "no limits" (dangerous)
});

// ========== HELPER UTIL ==========
function cleanTemp(filePath) {
  fs.unlink(filePath, (err) => { /* ignore */ });
}

// Determine file type by extension
function extFromMime(mimeType) {
  return mime.extension(mimeType) || '';
}

// ========== CONVERSION HANDLERS ==========

// Image conversions (sharp)
async function convertImage(inputPath, outputPath, outFormat) {
  // outFormat examples: 'png', 'jpeg', 'webp', 'avif', 'tiff'
  await sharp(inputPath).toFormat(outFormat).toFile(outputPath);
}

// Audio / video conversions using ffmpeg
function convertWithFFmpeg(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath).outputOptions(options.outputOptions || []);
    cmd.on('error', (err) => reject(err));
    cmd.on('end', () => resolve());
    cmd.save(outputPath);
  });
}

// LibreOffice conversions for docs <-> pdf (requires libreoffice installed)
function convertWithLibreOffice(inputPath, outputPath, targetExt) {
  return new Promise((resolve, reject) => {
    const ext = '.' + targetExt.replace(/^\./, '');
    const inputFile = fs.readFileSync(inputPath);
    libre.convert(inputFile, ext, undefined, (err, done) => {
      if (err) return reject(err);
      fs.writeFileSync(outputPath, done);
      resolve();
    });
  });
}

// Generic convert function (picks appropriate handler)
async function convertFile(inputPath, inputMime, targetFormat) {
  const inputExt = path.extname(inputPath).replace('.', '').toLowerCase();
  const outExt = targetFormat.replace(/^\./, '').toLowerCase();
  const outName = uuidv4() + '.' + outExt;
  const outPath = path.join(OUT_DIR, outName);

  // Image -> image
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'];
  const audioExts = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'];
  const videoExts = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
  const docExts = ['doc', 'docx', 'odt', 'rtf', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx', 'txt'];

  if (imageExts.includes(inputExt) && imageExts.includes(outExt)) {
    await convertImage(inputPath, outPath, outExt === 'jpg' ? 'jpeg' : outExt);
    return outPath;
  }

  // Image -> PDF
  if (imageExts.includes(inputExt) && outExt === 'pdf') {
    // Convert image to pdf via sharp (multipage not supported here)
    await sharp(inputPath).pdf().toFile(outPath);
    return outPath;
  }

  // PDF -> Image (first page only)
  if (inputExt === 'pdf' && imageExts.includes(outExt)) {
    // requires imagemagick/ghostscript for sharp to read pdfs in some environments;
    // fallback: use libreoffice to convert each page to image is more complex.
    await sharp(inputPath, { density: 300 }).toFormat(outExt).toFile(outPath);
    return outPath;
  }

  // Audio / Video conversions (use ffmpeg)
  if ((audioExts.includes(inputExt) || videoExts.includes(inputExt)) &&
      (audioExts.includes(outExt) || videoExts.includes(outExt))) {
    await convertWithFFmpeg(inputPath, outPath, {});
    return outPath;
  }

  // Docs and PDF conversions using LibreOffice
  if (docExts.includes(inputExt) && docExts.includes(outExt)) {
    // libreoffice-convert handles docx/odt/rtf/pdf/pptx/xlsx -> many formats
    await convertWithLibreOffice(inputPath, outPath, outExt);
    return outPath;
  }

  // TXT -> other simple conversions
  if (inputExt === 'txt' && outExt === 'pdf') {
    // make a simple one-page pdf (very basic)
    const content = fs.readFileSync(inputPath, 'utf8');
    const pdfBuffer = require('pdf-lib').PDFDocument.create().then(async (pdfDoc) => {
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      page.drawText(content.slice(0, 10000), { x: 20, y: height - 40, size: 12 });
      const out = await pdfDoc.save();
      fs.writeFileSync(outPath, out);
    });
    // wait above promise
    await pdfBuffer;
    return outPath;
  }

  throw new Error(`Conversion path not supported: .${inputExt} -> .${outExt}`);
}


// ========== ROUTES ==========

app.get('/', (req, res) => {
  // Minimal upload page
  res.send(`
<html>
<head><title>File Converter</title></head>
<body style="font-family: Arial; padding: 20px;">
  <h2>File converter (images/audio/video/docs)</h2>
  <form id="form" action="/convert" method="post" enctype="multipart/form-data">
    <label>Select file: <input type="file" name="file" required></label><br><br>
    <label>Output format (extension only, e.g. pdf, png, mp3, mp4, docx): 
      <input name="out" required placeholder="pdf">
    </label><br><br>
    <label>Keep original filename? <input type="checkbox" name="keepname"></label><br><br>
    <button type="submit">Upload & Convert</button>
  </form>
  <p style="color:gray">Note: server must have ffmpeg & libreoffice-installed for some conversions.</p>
</body>
</html>
  `);
});

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const outFormat = (req.body.out || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!outFormat) {
    cleanTemp(req.file.path);
    return res.status(400).send('Please provide output format (e.g. pdf, mp3, png).');
  }

  const keepName = !!req.body.keepname;
  const origName = req.file.originalname;
  const mimeType = req.file.mimetype || '';

  try {
    const convertedPath = await convertFile(req.file.path, mimeType, outFormat);
    // send as download
    const sendName = keepName
      ? path.basename(origName, path.extname(origName)) + '.' + outFormat
      : path.basename(convertedPath);

    res.download(convertedPath, sendName, (err) => {
      // cleanup both uploaded & output file after sending
      cleanTemp(req.file.path);
      // remove converted file after a short delay to ensure download started
      setTimeout(() => cleanTemp(convertedPath), 15 * 1000);
    });
  } catch (err) {
    cleanTemp(req.file.path);
    console.error('Conversion error:', err);
    res.status(500).send('Conversion failed: ' + (err.message || err.toString()));
  }
});

// Simple health
app.get('/health', (req, res) => res.json({ ok: true }));

// list out/ uploads (ADMIN only — not protected in this example)
app.get('/list-temp', (req, res) => {
  res.json({
    uploads: fs.readdirSync(UPLOAD_DIR),
    outs: fs.readdirSync(OUT_DIR)
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`File-converter server running on http://localhost:${PORT}`));
