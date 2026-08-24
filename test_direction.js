// 方角記号(N記号)自動検出のエンドツーエンド動作確認テスト
// 実PDF2件（浜松市中央区神田町553番=1/500・下石田町1578-2番=1/1000、
// Python版kouzu_to_dxf.pyの検証で使用したものと同じサンプル）を使い、
// detectDirectionSymbol()がdirectionレイヤーのLINEを生成し、DXF出力にも
// 反映されることを確認する。PDF自体は個人所有の登記情報のためリポジトリには
// 含めない。SAMPLESのpdfパスを手元の同種PDFに書き換えて実行すること。
const { chromium } = require('playwright');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'kouzu_reader.html');

const SAMPLES = [
  { name: '神田町553番(1/500)', pdf: 'C:\\Users\\hatta\\OneDrive\\ドキュメント\\PDF置き場\\浜松市中央区神田町５５３不動産登記（地図）2026082100048552.PDF', scale: 500 },
  { name: '下石田町1578-2番(1/1000)', pdf: 'C:\\Users\\hatta\\OneDrive\\ドキュメント\\PDF置き場\\浜松市中央区下石田町１５７８－２不動産登記（地図）2026043000068253.PDF', scale: 1000 },
];
const DPI = 300;

async function run() {
  const browser = await chromium.launch();
  let anyPageError = false;
  for (const s of SAMPLES) {
    const page = await browser.newPage();
    page.on('console', msg => {
      const t = msg.text();
      if (t.includes('[方角]') || t.includes('[3レイヤ分離]')) console.log('  [console]', t);
    });
    page.on('pageerror', err => { anyPageError = true; console.error('  [pageerror]', err.message); });
    await page.goto('file://' + HTML_PATH.replace(/\\/g, '/'));
    await page.waitForFunction(() => typeof processDocument === 'function', { timeout: 15000 });
    await page.setInputFiles('#fileInput', s.pdf);
    await page.waitForSelector('#scaleCheckPanel', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(300);
    await page.selectOption('#cadScale', String(s.scale));
    await page.evaluate((dpi) => {
      const el = document.getElementById('dpi'); el.value = dpi; el.dispatchEvent(new Event('input'));
    }, DPI);
    // OCR自動縮尺検出に依存せず、手動で確認済み扱いにしてボタンを有効化
    await page.evaluate(() => {
      document.getElementById('scaleConfirmed').checked = true;
      document.getElementById('processBtn').disabled = false;
    });

    console.log(`\n=== ${s.name} ===`);
    await page.click('#processBtn');
    await page.waitForFunction(() => geojsonResult !== null, { timeout: 180000 });
    await page.waitForTimeout(300);

    const summary = await page.evaluate(() => {
      const dirFeats = geojsonResult.features.filter(f => f.properties.layerType === 'direction');
      return {
        count: dirFeats.length,
        feats: dirFeats.map(f => ({ coords: f.geometry.coordinates, source: f.properties.source })),
      };
    });
    console.log('  direction features:', JSON.stringify(summary));

    // DXF・JWCダウンロード時にエラーが出ないか、方角レイヤが含まれるかも確認
    const dxfOk = await page.evaluate(() => {
      try {
        const dxf = geojsonToDXF(getVisibleGeojson(), geojsonResult._meta.scale_denom, lastDpi);
        return { ok: true, hasDirectionLayer: dxf.includes('kouzu_direction'), len: dxf.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    console.log('  DXF生成確認:', JSON.stringify(dxfOk));

    if (summary.count !== 1) throw new Error(`${s.name}: direction feature count expected 1, got ${summary.count}`);
    if (!dxfOk.ok || !dxfOk.hasDirectionLayer) throw new Error(`${s.name}: DXF出力に方角レイヤが含まれない`);

    await page.close();
  }
  await browser.close();
  if (anyPageError) throw new Error('pageerrorが発生しました');
  console.log('\nOK: 2サンプルとも方角レイヤが検出・DXF出力に反映されました');
}

run().catch(e => { console.error(e); process.exit(1); });
