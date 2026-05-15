// Скачивает фото-слои всех шаблонов из Figma.
// Запускать: node server/scripts/download-figma-photos.js
// После завершения запустить: node server/scripts/setup-photos.js
const fs   = require('fs');
const path = require('path');
const https = require('https');

const TOKEN   = process.env.FIGMA_TOKEN || 'figd__8C3v79iH33BNK8-Tt_fkHY0BU42yOg5sQDfIyDQ';
const FILE_ID = 'gdpxA3fEw77kzhnC1x7Cax';
const FRAME_ID = '237:4603';
const LAYERS_DIR = path.join(__dirname, '../../client/images/templates/layers');

const HEADERS = { 'X-Figma-Token': TOKEN };

// Шаблон → ожидаемое имя файла (как в TEMPLATE_CONFIG)
const TEMPLATE_PHOTO_MAP = {
  'nahodki-1':        'nahodki-1_photo.png',
  'nahodki-2':        null, // использует nahodki-1_photo.png — не скачиваем отдельно
  'nahodki-prazdnik': 'nahodki-prazdnik_photo.png',
  'community-1':      'community-1_photo.png',
  'community-2':      'community-2_photo.png',
  'community-3':      'community-3_photo.png',
  'gayd-1':           'gayd-1_photo.png',
  'prazdnik-1':       'prazdnik-1_photo.png',
  'prazdnik-2':       'prazdnik-2_photo.png',
  'prazdnik-3':       'prazdnik-3_photo.png',
  'novinka-1':        'novinka-1_photo.png',
  'polezno-1':        'polezno-1_photo.png',
};

function figmaGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://api.figma.com/v1${endpoint}`;
    https.get(url, { headers: HEADERS }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Figma API ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🔍 Получаю структуру фрейма шаблонов...');

  // Шаг 1 — получаем дочерние фреймы (шаблоны)
  const frameData = await figmaGet(`/files/${FILE_ID}/nodes?ids=${encodeURIComponent(FRAME_ID)}&depth=3`);
  const keys = Object.keys(frameData.nodes);
  const rootNode = frameData.nodes[keys[0]].document;

  console.log(`Фрейм: "${rootNode.name}", дочерних: ${rootNode.children?.length || 0}`);

  // Шаг 2 — для каждого дочернего фрейма ищем слой с фото
  const photoNodes = {}; // templateName → nodeId

  for (const child of (rootNode.children || [])) {
    const templateName = child.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`\n  [${child.id}] "${child.name}"`);

    // Ищем дочерний слой с фото: по имени (photo, фото, illustration, иллюстрация, img)
    const photoLayer = (child.children || []).find(l => {
      const n = l.name.toLowerCase();
      return n.includes('photo') || n.includes('фото') || n.includes('illustration')
          || n.includes('иллюстрация') || n.includes('img') || n.includes('картинка');
    });

    if (photoLayer) {
      console.log(`    ✅ фото-слой: "${photoLayer.name}" [${photoLayer.id}]`);
      photoNodes[child.name] = { nodeId: photoLayer.id, frameName: child.name };
    } else {
      // Показываем что есть
      const layers = (child.children || []).map(l => `"${l.name}"`).join(', ');
      console.log(`    ⚠️  фото-слой не найден. Дочерние: ${layers || 'нет'}`);
    }
  }

  if (Object.keys(photoNodes).length === 0) {
    console.log('\n❌ Не нашёл ни одного фото-слоя. Проверь имена слоёв в Figma.');
    console.log('   Ожидаемые имена: photo, фото, illustration, иллюстрация, img, картинка');
    process.exit(1);
  }

  // Шаг 3 — экспортируем через Figma images API
  console.log(`\n🖼️  Запрашиваю экспорт ${Object.keys(photoNodes).length} слоёв...`);
  const nodeIds = Object.values(photoNodes).map(n => n.nodeId).join(',');

  await sleep(1000); // пауза между запросами
  const exportData = await figmaGet(
    `/images/${FILE_ID}?ids=${encodeURIComponent(nodeIds)}&format=png&scale=2`
  );

  if (exportData.err) {
    console.error('❌ Ошибка экспорта:', exportData.err);
    process.exit(1);
  }

  // Шаг 4 — скачиваем каждый PNG
  for (const [frameName, { nodeId }] of Object.entries(photoNodes)) {
    const imgUrl = exportData.images[nodeId];
    if (!imgUrl) {
      console.log(`⚠️  Нет URL для ${frameName}`);
      continue;
    }

    // Находим правильное имя файла из маппинга
    const templateKey = Object.keys(TEMPLATE_PHOTO_MAP).find(k =>
      frameName.toLowerCase().includes(k.replace(/-/g, ' ').toLowerCase()) ||
      frameName.toLowerCase().includes(k.toLowerCase())
    );
    const filename = templateKey ? TEMPLATE_PHOTO_MAP[templateKey] : `${frameName.toLowerCase().replace(/\s+/g, '-')}_photo.png`;

    if (!filename) {
      console.log(`⏭️  ${frameName}: пропускаем (использует чужой слой)`);
      continue;
    }

    const dest = path.join(LAYERS_DIR, filename);
    process.stdout.write(`⬇️  ${filename}...`);
    await downloadFile(imgUrl, dest);
    console.log(' ✅');
    await sleep(300);
  }

  console.log('\n🎉 Готово! Теперь запусти:');
  console.log('   node server/scripts/setup-photos.js');
  console.log('   (пересчитает позиционирование для всех новых фото)');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
