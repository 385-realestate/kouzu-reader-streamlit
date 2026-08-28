// JWC出力ボタンの拡張子バグ修正確認テスト
// python -m http.server 8899 で本ファイルと同ディレクトリを配信した状態で実行すること
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('http://127.0.0.1:8899/kouzu_reader.html');

  // 変換実行結果を模擬注入（PDF読込・OCRをスキップし、最小のGeoJSONを直接設定）
  await page.evaluate(() => {
    geojsonResult = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0,0],[100,0],[100,100],[0,100],[0,0]]] },
          properties: { layerType: undefined }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [50, 50] },
          properties: { text: '123番', layerType: 'label' }
        }
      ],
      _meta: {
        coordinate_system: 'pixel',
        img_size: [800, 600],
        scale_denom: 500,
        dpi: 200,
        feature_count: 2,
        generated: new Date().toISOString().slice(0, 19),
      }
    };
    lastDpi = 200;
    // getVisibleGeojsonが参照するlayerVisibleを全表示にしておく
    layerVisible.border = true; layerVisible.frame = true;
    layerVisible.label = true; layerVisible.direction = true;
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => downloadJWC()),
  ]);

  const suggested = download.suggestedFilename();
  console.log('ダウンロードファイル名:', suggested);

  const savePath = path.join(__dirname, '_test_jwc_output', suggested);
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  await download.saveAs(savePath);

  const ext = path.extname(suggested);
  if (ext !== '.jwc') {
    console.error(`FAIL: 拡張子が .jwc になっていない（実際: ${ext}）`);
    await browser.close();
    process.exit(1);
  }
  console.log('PASS: ダウンロードファイルの拡張子が .jwc になっている');

  const buf = fs.readFileSync(savePath);
  // Shift_JISで書き出しているためNode側でデコード（iconv-liteが無い環境向けに簡易デコード）
  let text;
  try {
    text = new TextDecoder('shift-jis').decode(buf);
  } catch (e) {
    text = buf.toString('utf-8'); // フォールバック（文字化けしても構造チェックはできる）
  }

  console.log('--- ファイル先頭200文字 ---');
  console.log(text.slice(0, 200));
  console.log('--- ファイルサイズ ---', buf.length, 'bytes');

  const checks = [
    ['# Jw_cad Data ヘッダ', text.includes('# Jw_cad Data')],
    ['HST行', text.includes('HST')],
    ['縮尺(S)行', /^S /m.test(text)],
    ['WL(レイヤ指定)行', /^WL /m.test(text)],
    ['線データ(l )行', /^l /m.test(text)],
    ['テキスト(TJ)行', /^TJ /m.test(text)],
  ];
  let allOk = true;
  for (const [label, ok] of checks) {
    console.log(`  [${ok ? 'OK' : 'NG'}] ${label}`);
    if (!ok) allOk = false;
  }

  console.log('consoleエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.join('\n'));

  if (!allOk) {
    console.error('FAIL: 期待した内部構造の一部が見つからない');
    await browser.close();
    process.exit(1);
  }

  console.log('PASS: 拡張子修正後もJWCデータ本体の構造は変化していないことを確認');
  await browser.close();
})();
