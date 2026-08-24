// 距離測定機能(📏)のバグ再現・修正確認テスト
// python -m http.server 8899 で本ファイルと同ディレクトリを配信した状態で実行すること
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('http://127.0.0.1:8899/kouzu_reader.html');

  // 変換実行後の状態を模擬（OCR/PDF変換をスキップし、既存のグローバル状態を直接注入）
  await page.evaluate(() => {
    const pc = document.getElementById('previewCanvas');
    pc.width = 1200; pc.height = 900;
    storedPdfCanvas = pc;              // truthyであればOK（drawImage先として自身を使う）
    storedCanvasW = 1200; storedCanvasH = 900;
    storedScaleDen = 500; storedRendDpi = 200;
    storedLineFeats = []; storedTextFeats = [];
    centerCanvas();
  });

  // 📏ボタンをクリックして測定モードON
  await page.click('#measureBtn');
  const modeAfterToggle = await page.evaluate(() => ({
    measureMode, pointsLen: measurePoints.length, points: measurePoints.slice()
  }));
  console.log('ボタンクリック直後:', JSON.stringify(modeAfterToggle));

  if (modeAfterToggle.pointsLen !== 0) {
    console.error('FAIL: 📏ボタンのクリック自体が測定点としてカウントされている（バグ再現）');
    await browser.close();
    process.exit(1);
  }

  // 地図上（canvasWrap内、zoom-ctrl以外の領域）で1回目クリック
  const wrapBox = await page.locator('#canvasWrap').boundingBox();
  const click1 = { x: wrapBox.x + wrapBox.width * 0.3, y: wrapBox.y + wrapBox.height * 0.6 };
  await page.mouse.click(click1.x, click1.y);

  const afterClick1 = await page.evaluate(() => ({
    pointsLen: measurePoints.length, points: measurePoints.slice()
  }));
  console.log('1回目クリック後:', JSON.stringify(afterClick1));

  if (afterClick1.pointsLen !== 1) {
    console.error('FAIL: 1回目クリック後に測定点が1個になっていない');
    await browser.close();
    process.exit(1);
  }

  // 期待するローカル座標（ボタン座標ではなく実際にクリックした地図上の座標）に近いか検証
  const expected = await page.evaluate((c) => {
    const wrap = document.getElementById('canvasWrap');
    const r = wrap.getBoundingClientRect();
    const localX = c.x - r.left, localY = c.y - r.top;
    return { px: (localX - viewX) / viewScale, py: (localY - viewY) / viewScale };
  }, click1);
  console.log('期待される1点目座標(近似):', JSON.stringify(expected));

  const p1 = afterClick1.points[0];
  const diff = Math.hypot(p1.x - expected.px, p1.y - expected.py);
  console.log('1点目座標と期待値の差:', diff.toFixed(2), 'px');
  if (diff > 5) {
    console.error('FAIL: 1点目の座標が意図した地図上の位置とズレている');
    await browser.close();
    process.exit(1);
  }

  // 地図上で2回目クリック
  const click2 = { x: wrapBox.x + wrapBox.width * 0.6, y: wrapBox.y + wrapBox.height * 0.3 };
  await page.mouse.click(click2.x, click2.y);

  const afterClick2 = await page.evaluate(() => ({
    pointsLen: measurePoints.length,
    label: document.getElementById('measureLabel').textContent
  }));
  console.log('2回目クリック後:', JSON.stringify(afterClick2));

  if (afterClick2.pointsLen !== 2) {
    console.error('FAIL: 2回目クリック後に測定点が2個になっていない');
    await browser.close();
    process.exit(1);
  }
  if (!/距離:/.test(afterClick2.label)) {
    console.error('FAIL: 距離表示ラベルが更新されていない:', afterClick2.label);
    await browser.close();
    process.exit(1);
  }

  console.log('距離表示ラベル:', afterClick2.label);
  console.log('consoleエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.join('\n'));

  console.log('PASS: 📏ボタン→地図2点クリックで正しく距離が測定された');
  await browser.close();
})();
