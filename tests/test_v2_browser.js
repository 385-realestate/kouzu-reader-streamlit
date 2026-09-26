// 実PDF統合確認: KOUZU_SAMPLE_PDF に手元の公図PDFを指定して実行する。
const { chromium } = require('playwright');

async function run() {
  if (!process.env.KOUZU_SAMPLE_PDF) {
    console.log('SKIP: KOUZU_SAMPLE_PDF を指定してください');
    return;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: {width: 1600, height: 1600} });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.KOUZU_BASE_URL || 'http://127.0.0.1:8511/kouzu/');
    await page.setInputFiles('#pdf', process.env.KOUZU_SAMPLE_PDF);
    await page.click('#convert');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('完了'),
      null, { timeout: 120000 });
    if (!await page.locator('#preview').isVisible()) throw new Error('原本プレビューが表示されない');
    if (!await page.locator('#overlay').isVisible()) throw new Error('抽出線が表示されない');
    if (process.env.KOUZU_SCREENSHOT) {
      await page.screenshot({path: process.env.KOUZU_SCREENSHOT, fullPage: true});
    }
    const [geojsonDownload] = await Promise.all([
      page.waitForEvent('download'), page.click('#geojson')
    ]);
    const [dxfDownload] = await Promise.all([
      page.waitForEvent('download'), page.click('#dxf')
    ]);
    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'), page.click('#png')
    ]);
    if (!pngDownload.suggestedFilename().endsWith('.png')) throw new Error('PNG download failed');
    await page.click('#measure');
    const box = await page.locator('#overlay').boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7);
    const distanceText = await page.locator('#distance').textContent();
    if (!distanceText.includes('m')) {
      throw new Error(`Distance measurement failed: ${distanceText}`);
    }
    if (!geojsonDownload.suggestedFilename().endsWith('.geojson')) throw new Error('GeoJSON出力に失敗');
    if (!dxfDownload.suggestedFilename().endsWith('.dxf')) throw new Error('DXF出力に失敗');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS: 変換、原本重ね合わせ、GeoJSON/DXF/PNG出力、距離測定');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
