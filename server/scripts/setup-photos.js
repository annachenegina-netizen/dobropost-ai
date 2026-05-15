// Авто-расчёт позиционирования фото для всех шаблонов.
// Запускать после добавления новых *_photo.png в client/images/templates/layers/
// Использование: node server/scripts/setup-photos.js
const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const LAYERS_DIR     = path.join(__dirname, '../../client/images/templates/layers');
const POSITIONS_FILE = path.join(__dirname, '../config/photo-positions.json');
const BANNER_H = 350;

// Находим bounding box непрозрачных пикселей
function findBoundingBox(png) {
  let minX = png.width, maxX = 0, minY = png.height, maxY = 0;
  let found = false;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  return found ? { minX, maxX, minY, maxY } : null;
}

// Считаем CSS-параметры из bounding box
function calcPosition(png, bbox) {
  const bboxW = bbox.maxX - bbox.minX + 1;
  const bboxH = bbox.maxY - bbox.minY + 1;
  const scale = BANNER_H / bboxH;
  return {
    wrapW:   Math.round(bboxW * scale),
    wrapH:   BANNER_H,
    imgW:    Math.round(png.width * scale),
    imgH:    Math.round(png.height * scale),
    imgLeft: -Math.round(bbox.minX * scale),
    imgTop:  -Math.round(bbox.minY * scale),
  };
}

const existing = fs.existsSync(POSITIONS_FILE)
  ? JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'))
  : {};

const files = fs.readdirSync(LAYERS_DIR).filter(f => f.endsWith('_photo.png'));

if (files.length === 0) {
  console.log('Нет файлов *_photo.png в папке layers/');
  process.exit(0);
}

let updated = 0;
for (const file of files) {
  const filePath = path.join(LAYERS_DIR, file);
  const raw = fs.readFileSync(filePath);
  const png = PNG.sync.read(raw);

  const bbox = findBoundingBox(png);
  if (!bbox) {
    console.log(`⚠️  ${file}: полностью прозрачный, пропускаем`);
    continue;
  }

  const pos = calcPosition(png, bbox);
  const bboxW = bbox.maxX - bbox.minX + 1;
  const bboxH = bbox.maxY - bbox.minY + 1;

  console.log(`✅ ${file}`);
  console.log(`   PNG: ${png.width}×${png.height}  bbox: x=${bbox.minX}-${bbox.maxX} y=${bbox.minY}-${bbox.maxY} (${bboxW}×${bboxH})`);
  console.log(`   scale=${(BANNER_H / bboxH).toFixed(3)}  wrap=${pos.wrapW}×${pos.wrapH}  img=${pos.imgW}×${pos.imgH}  left=${pos.imgLeft} top=${pos.imgTop}`);

  existing[file] = pos;
  updated++;
}

fs.writeFileSync(POSITIONS_FILE, JSON.stringify(existing, null, 2));
console.log(`\n💾 Обновлено ${updated} позиций → ${POSITIONS_FILE}`);
