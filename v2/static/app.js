(() => {
  'use strict';
  const prefix = document.body.dataset.prefix || '';
  const pdf = document.querySelector('#pdf');
  const convert = document.querySelector('#convert');
  const status = document.querySelector('#status');
  const image = document.querySelector('#preview');
  const canvas = document.querySelector('#overlay');
  const ctx = canvas.getContext('2d');
  const roleButtons = [...document.querySelectorAll('[data-role]')];
  const undoButton = document.querySelector('#undo');
  const showLabels = document.querySelector('#show-labels');
  const showTextStrokes = document.querySelector('#show-text-strokes');
  let geojson = null;
  let selected = -1;
  let undoStack = [];
  let measureMode = false;
  let measurePoints = [];
  const measureButton = document.querySelector('#measure');
  const distanceLabel = document.querySelector('#distance');

  function toPixel(point) {
    const meta = geojson.properties;
    return [point[0] / meta.pageWidthMm * canvas.width,
            (meta.pageHeightMm - point[1]) / meta.pageHeightMm * canvas.height];
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!geojson) return;
    geojson.features.forEach((feature, index) => {
      const geometry = feature.geometry || {};
      const role = feature.properties?.role;
      if (geometry.type === 'Point') {
        if (!showLabels.checked) return;
        const [x, y] = toPixel(geometry.coordinates);
        ctx.font = `bold ${Math.max(11, canvas.width / 90)}px sans-serif`;
        ctx.fillStyle = '#087947';
        ctx.fillText(feature.properties.text || '', x, y);
        return;
      }
      if (geometry.type !== 'LineString' || geometry.coordinates.length < 2) return;
      if (role === 'text_stroke' && !showTextStrokes.checked) return;
      const points = geometry.coordinates.map(toPixel);
      ctx.beginPath(); ctx.moveTo(...points[0]);
      points.slice(1).forEach(point => ctx.lineTo(...point));
      ctx.strokeStyle = index === selected ? '#efb315' : {
        frame: '#8a9ba2', text_stroke: '#1b82c4', boundary_candidate: '#d83c34'
      }[role] || '#d83c34';
      ctx.lineWidth = index === selected ? 3 : Math.max(1, canvas.width / 1600);
      ctx.stroke();
    });
    if (measurePoints.length) {
      ctx.fillStyle = '#e7a415';
      ctx.strokeStyle = '#e7a415';
      ctx.lineWidth = 3;
      if (measurePoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(...measurePoints[0]);
        ctx.lineTo(...measurePoints[1]);
        ctx.stroke();
      }
      for (const [x, y] of measurePoints) {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function distanceToSegment(px, py, start, end) {
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const denom = dx * dx + dy * dy;
    const t = denom ? Math.max(0, Math.min(1,
      ((px - start[0]) * dx + (py - start[1]) * dy) / denom)) : 0;
    return Math.hypot(px - start[0] - t * dx, py - start[1] - t * dy);
  }

  function updateSelection() {
    const feature = geojson?.features[selected];
    const label = document.querySelector('#selection');
    if (!feature) {
      label.textContent = '線を選択してください';
      roleButtons.forEach(button => { button.disabled = true; button.classList.remove('active'); });
      return;
    }
    label.textContent = `${feature.properties.lineId}：${feature.properties.role}`;
    roleButtons.forEach(button => {
      button.disabled = false;
      button.classList.toggle('active', button.dataset.role === feature.properties.role);
    });
  }

  canvas.addEventListener('click', event => {
    if (!geojson) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    if (measureMode) {
      if (measurePoints.length === 2) measurePoints = [];
      measurePoints.push([x, y]);
      if (measurePoints.length === 2) {
        const mmX = (measurePoints[1][0] - measurePoints[0][0]) / canvas.width * geojson.properties.pageWidthMm;
        const mmY = (measurePoints[1][1] - measurePoints[0][1]) / canvas.height * geojson.properties.pageHeightMm;
        const metres = Math.hypot(mmX, mmY) / 1000;
        distanceLabel.textContent = `現地換算 約 ${metres.toFixed(2)} m（指定縮尺 1:${geojson.properties.scaleDenominator}）`;
      } else distanceLabel.textContent = 'もう1点をクリックしてください';
      draw();
      return;
    }
    let best = 9 * canvas.width / rect.width;
    let bestIndex = -1;
    geojson.features.forEach((feature, index) => {
      if (feature.geometry.type !== 'LineString') return;
      if (feature.properties.role === 'text_stroke' && !showTextStrokes.checked) return;
      const coords = feature.geometry.coordinates.map(toPixel);
      for (let i = 1; i < coords.length; i++) {
        const distance = distanceToSegment(x, y, coords[i - 1], coords[i]);
        if (distance < best) { best = distance; bestIndex = index; }
      }
    });
    selected = bestIndex; updateSelection(); draw();
  });

  roleButtons.forEach(button => button.addEventListener('click', () => {
    if (selected < 0) return;
    const properties = geojson.features[selected].properties;
    undoStack.push({index: selected, role: properties.role});
    properties.role = button.dataset.role;
    undoButton.disabled = false;
    updateSelection(); draw();
  }));
  undoButton.addEventListener('click', () => {
    const previous = undoStack.pop();
    if (!previous) return;
    geojson.features[previous.index].properties.role = previous.role;
    undoButton.disabled = !undoStack.length;
    updateSelection(); draw();
  });
  [showLabels, showTextStrokes].forEach(input => input.addEventListener('change', draw));
  measureButton.addEventListener('click', () => {
    measureMode = !measureMode;
    measurePoints = [];
    measureButton.classList.toggle('active', measureMode);
    distanceLabel.textContent = measureMode ? '図面上の2点をクリックしてください' : '';
    draw();
  });
  pdf.addEventListener('change', () => {
    document.querySelector('#file-label').textContent = pdf.files[0]?.name || '公図PDFを選択';
  });

  convert.addEventListener('click', async () => {
    if (!pdf.files.length) { status.textContent = '公図PDFを選択してください'; return; }
    convert.disabled = true;
    document.querySelector('#geojson').disabled = true;
    document.querySelector('#dxf').disabled = true;
    status.textContent = 'PDFを解析中です…';
    const form = new FormData();
    form.append('pdf', pdf.files[0]);
    for (const [field, id] of Object.entries({
      page: 'page', scale: 'scale', dpi: 'dpi',
      top_exclusion: 'top-exclusion', bottom_exclusion: 'bottom-exclusion'
    })) form.append(field, document.getElementById(id).value);
    try {
      const response = await fetch(`${prefix}/api/convert`, {method: 'POST', body: form});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '変換に失敗しました');
      geojson = data.geojson; selected = -1; undoStack = [];
      measureMode = false; measurePoints = [];
      measureButton.classList.remove('active');
      distanceLabel.textContent = '';
      undoButton.disabled = true; updateSelection();
      const meta = geojson.properties;
      document.querySelector('#stats').innerHTML = `<div><dt>線</dt><dd>${meta.lineCount}</dd></div><div><dt>地番候補</dt><dd>${meta.ocrLabelCount}</dd></div><div><dt>方式</dt><dd>${meta.lineSource === 'raster' ? '画像解析' : 'ベクター'}</dd></div>`;
      const warning = document.querySelector('#warning');
      warning.hidden = !meta.ocrWarning;
      warning.textContent = meta.ocrWarning || '';
      image.onload = () => {
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        image.style.display = 'block'; canvas.style.display = 'block';
        document.querySelector('#empty').hidden = true;
        draw();
      };
      image.src = data.preview;
      document.querySelector('#geojson').disabled = false;
      document.querySelector('#dxf').disabled = false;
      document.querySelector('#png').disabled = false;
      measureButton.disabled = false;
      status.textContent = `完了：${meta.lineCount}本の線、${meta.ocrLabelCount}件の地番候補`;
    } catch (error) { status.textContent = error.message; }
    finally { convert.disabled = false; }
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.querySelector('#geojson').addEventListener('click', () => {
    if (geojson) download(new Blob([JSON.stringify(geojson, null, 2)], {type: 'application/geo+json'}), 'kouzu_conversion.geojson');
  });
  document.querySelector('#png').addEventListener('click', () => {
    if (!geojson || !image.complete) return;
    const composite = document.createElement('canvas');
    composite.width = canvas.width; composite.height = canvas.height;
    const compositeContext = composite.getContext('2d');
    compositeContext.drawImage(image, 0, 0);
    compositeContext.drawImage(canvas, 0, 0);
    composite.toBlob(blob => { if (blob) download(blob, 'kouzu_overlay.png'); }, 'image/png');
  });
  document.querySelector('#dxf').addEventListener('click', async () => {
    if (!geojson) return;
    const response = await fetch(`${prefix}/api/export-dxf`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({geojson})
    });
    if (!response.ok) { status.textContent = 'DXFの作成に失敗しました'; return; }
    download(await response.blob(), 'kouzu_conversion.dxf');
  });
})();
