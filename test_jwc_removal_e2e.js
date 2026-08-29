// JWC出力削除後の動作確認テスト
// python -m http.server 8899 で本ファイルと同ディレクトリを配信した状態で実行すること
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('http://127.0.0.1:8899/kouzu_reader.html');

  // 1. JWCボタンがDOMに存在しないこと
  const jwcBtnCount = await page.locator('#jwcBtn').count();
  console.log('jwcBtnCount:', jwcBtnCount);
  if (jwcBtnCount !== 0) {
    console.error('FAIL: #jwcBtn が残っている');
    await browser.close(); process.exit(1);
  }

  // 2. downloadJWC / geojsonToJWC / detectLayer_JWC が未定義であること
  const fnCheck = await page.evaluate(() => ({
    downloadJWC: typeof window.downloadJWC,
    geojsonToJWC: typeof window.geojsonToJWC,
    detectLayer_JWC: typeof window.detectLayer_JWC,
    downloadDXF: typeof window.downloadDXF,
    downloadGeoJSON: typeof window.downloadGeoJSON,
    downloadPNG: typeof window.downloadPNG,
  }));
  console.log('関数存在チェック:', JSON.stringify(fnCheck));
  if (fnCheck.downloadJWC !== 'undefined' || fnCheck.geojsonToJWC !== 'undefined' || fnCheck.detectLayer_JWC !== 'undefined') {
    console.error('FAIL: JWC関連関数が残っている');
    await browser.close(); process.exit(1);
  }
  if (fnCheck.downloadDXF !== 'function' || fnCheck.downloadGeoJSON !== 'function' || fnCheck.downloadPNG !== 'function') {
    console.error('FAIL: 他の出力関数が消えてしまっている');
    await browser.close(); process.exit(1);
  }

  // 3. 3ボタン構成（GeoJSON/DXF/PNG）を確認
  const dlGroupButtons = await page.locator('.dl-group button').allTextContents();
  console.log('dl-groupボタン:', JSON.stringify(dlGroupButtons));
  if (dlGroupButtons.length !== 3) {
    console.error('FAIL: dl-groupのボタン数が3ではない:', dlGroupButtons.length);
    await browser.close(); process.exit(1);
  }

  // 4. 実PDFを読み込んで変換実行 → GeoJSON/DXFダウンロード・距離測定・PNG保存を確認
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles(path.join(__dirname, 'test_target.pdf'));

  await page.waitForFunction(() => !document.getElementById('processBtn').disabled, null, { timeout: 30000 });
  console.log('PDF読込完了、変換実行ボタン押下');

  await page.click('#processBtn');
  await page.waitForFunction(() => !document.getElementById('downloadBtn').disabled, null, { timeout: 180000 });
  console.log('変換完了');

  const featureCount = await page.locator('#featureCount').textContent();
  console.log('抽出結果:', featureCount);

  // GeoJSONダウンロード
  const [dlGeojson] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#downloadBtn'),
  ]);
  console.log('GeoJSONダウンロード:', dlGeojson.suggestedFilename());
  if (!dlGeojson.suggestedFilename().endsWith('.geojson')) {
    console.error('FAIL: GeoJSONの拡張子が不正');
    await browser.close(); process.exit(1);
  }

  // DXFダウンロード
  const [dlDxf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#dxfBtn'),
  ]);
  console.log('DXFダウンロード:', dlDxf.suggestedFilename());
  if (!dlDxf.suggestedFilename().endsWith('.dxf')) {
    console.error('FAIL: DXFの拡張子が不正');
    await browser.close(); process.exit(1);
  }
  const dxfPath = await dlDxf.path();
  const dxfSize = require('fs').statSync(dxfPath).size;
  console.log('DXFファイルサイズ:', dxfSize, 'bytes');
  if (dxfSize < 100) {
    console.error('FAIL: DXFファイルの中身が空に近い');
    await browser.close(); process.exit(1);
  }

  // 距離測定（📏）
  await page.click('#measureBtn');
  const wrapBox = await page.locator('#canvasWrap').boundingBox();
  await page.mouse.click(wrapBox.x + wrapBox.width * 0.3, wrapBox.y + wrapBox.height * 0.6);
  await page.mouse.click(wrapBox.x + wrapBox.width * 0.6, wrapBox.y + wrapBox.height * 0.3);
  const measureLabel = await page.locator('#measureLabel').textContent();
  console.log('距離測定結果:', measureLabel);
  if (!/距離:/.test(measureLabel)) {
    console.error('FAIL: 距離測定が機能していない');
    await browser.close(); process.exit(1);
  }

  // PNG保存
  const [dlPng] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#pngBtn'),
  ]);
  console.log('PNGダウンロード:', dlPng.suggestedFilename());
  if (!dlPng.suggestedFilename().endsWith('.png')) {
    console.error('FAIL: PNGの拡張子が不正');
    await browser.close(); process.exit(1);
  }

  console.log('consoleエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.join('\n'));

  console.log('PASS: JWC削除後もGeoJSON/DXF出力・距離測定・PNG保存が正常動作');
  await browser.close();
})().catch(e => {
  console.error('EXCEPTION:', e);
  process.exit(1);
});
