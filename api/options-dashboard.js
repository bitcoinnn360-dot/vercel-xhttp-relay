export const config = { runtime: "edge" };

// Simple options trading dashboard: 3 levels + transition probabilities on a live chart.

export default async function handler(req) {
  const u = new URL(req.url);
  const currency = (u.searchParams.get("currency") || "BTC").toUpperCase();
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Options Levels · ${currency}</title>
  <script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a222d;
      --text: #e7ecf3;
      --muted: #8b98a8;
      --put: #42a5f5;
      --max: #ffca28;
      --call: #ef5350;
      --line: #2a3544;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Segoe UI", Tahoma, sans-serif;
      background: radial-gradient(1200px 600px at 80% -10%, #1b2a3a 0%, var(--bg) 55%);
      color: var(--text);
    }
    header {
      padding: 18px 20px 8px; display: flex; flex-wrap: wrap; gap: 12px;
      align-items: baseline; justify-content: space-between;
    }
    h1 { margin: 0; font-size: 1.25rem; font-weight: 700; }
    .sub { color: var(--muted); font-size: 0.85rem; }
    .wrap { padding: 0 16px 24px; display: grid; gap: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .card {
      background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
    }
    .card .k { color: var(--muted); font-size: 0.75rem; margin-bottom: 4px; }
    .card .v { font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .put { color: var(--put); } .max { color: var(--max); } .call { color: var(--call); }
    #chart {
      height: min(62vh, 560px); background: var(--panel);
      border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
    }
    .probs {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;
    }
    .prob-card {
      background: linear-gradient(180deg, #1d2836, var(--panel));
      border: 1px solid var(--line); border-radius: 12px; padding: 14px;
    }
    .prob-card strong { font-size: 1.4rem; }
    .bar {
      height: 8px; border-radius: 99px; background: #263141; overflow: hidden; margin-top: 8px;
    }
    .bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--put), var(--max)); }
    .note {
      color: var(--muted); font-size: 0.78rem; line-height: 1.5;
      border: 1px dashed var(--line); border-radius: 10px; padding: 10px 12px;
    }
    button {
      background: #2b3b4f; color: var(--text); border: 1px solid var(--line);
      border-radius: 8px; padding: 6px 10px; cursor: pointer;
    }
    code { color: #9fd0ff; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>سطوح آپشن ${currency} · Put / Max Pain / Call</h1>
      <div class="sub" id="meta">در حال بارگذاری…</div>
    </div>
    <div style="display:flex; gap:8px; align-items:center;">
      <button id="refresh" type="button">بروزرسانی</button>
    </div>
  </header>
  <div class="wrap">
    <div class="cards" id="cards"></div>
    <div id="chart"></div>
    <div class="probs" id="probs"></div>
    <div class="note">
      احتمال‌ها برآورد مدل ریسک‌خنثی با ATM IV هستند (GBM، r≈0): مثلاً «Put Wall → Max Pain»
      یعنی شانس رسیدن به Max Pain قبل از برگشت به سمت Put Wall، وقتی قیمت بین این دو سطح است.
      این تضمین نیست؛ خبر و فلوی دیلر می‌تواند مسیر را عوض کند.
      برای TradingView از <code>/api/options-levels?currency=${currency}</code> فیلد
      <code>pine_inputs</code> را در اندیکاتور Options Levels وارد کنید.
    </div>
  </div>
  <script>
    const currency = ${JSON.stringify(currency)};
    const chartEl = document.getElementById('chart');
    const chart = LightweightCharts.createChart(chartEl, {
      layout: { background: { color: '#1a222d' }, textColor: '#c5d0dc' },
      grid: { vertLines: { color: '#243041' }, horzLines: { color: '#243041' } },
      rightPriceScale: { borderColor: '#2a3544' },
      timeScale: { borderColor: '#2a3544', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addAreaSeries({
      lineColor: '#7eb6ff', topColor: 'rgba(126,182,255,0.25)', bottomColor: 'rgba(126,182,255,0.02)',
      lineWidth: 2,
    });
    let priceLines = [];

    function clearLines() {
      for (const pl of priceLines) series.removePriceLine(pl);
      priceLines = [];
    }
    function addLine(price, color, title) {
      if (price == null) return;
      priceLines.push(series.createPriceLine({
        price, color, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true, title,
      }));
    }

    async function loadBinanceCandles() {
      const symbol = currency === 'ETH' ? 'ETHUSDT' : 'BTCUSDT';
      const url = 'https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=15m&limit=200';
      const rows = await fetch(url).then(r => r.json());
      return rows.map(k => ({ time: Math.floor(k[0] / 1000), value: Number(k[4]) }));
    }

    function renderCards(data) {
      const L = data.levels || {};
      const D = data.details || {};
      const h = (data.probabilities && data.probabilities.highlight) || {};
      const cards = [
        ['Spot', data.spot, ''],
        ['Put Wall', L.put_wall, 'put'],
        ['Max Pain', L.max_pain, 'max'],
        ['Call Wall', L.call_wall, 'call'],
        ['ATM IV', D.atm_iv_pct != null ? D.atm_iv_pct.toFixed(1) + '%' : '—', ''],
        ['DVOL', D.dvol && D.dvol.last != null ? D.dvol.last.toFixed(1) : '—', ''],
      ];
      document.getElementById('cards').innerHTML = cards.map(([k,v,c]) =>
        '<div class="card"><div class="k">' + k + '</div><div class="v ' + c + '">' + (v ?? '—') + '</div></div>'
      ).join('');

      const items = [
        ['Put Wall → Max Pain', h.put_wall_to_max_pain_pct, 'var(--put)'],
        ['Max Pain → Put Wall', h.max_pain_to_put_wall_pct, 'var(--max)'],
        ['Max Pain → Call Wall', h.max_pain_to_call_wall_pct, 'var(--max)'],
        ['Call Wall → Max Pain', h.call_wall_to_max_pain_pct, 'var(--call)'],
      ];
      const next = h.next_move;
      let nextHtml = '';
      if (next && next.probability_pct != null) {
        nextHtml = '<div class="prob-card" style="grid-column: 1 / -1; border-color:#3d5a80">' +
          '<div class="k">حرکت محتمل بعدی (نسبت به محل قیمت)</div>' +
          '<div><strong>' + next.probability_pct + '%</strong> · ' + next.scenario + '</div>' +
          (next.opposite_probability_pct != null
            ? '<div class="sub" style="margin-top:6px">مخالف: ' + next.opposite_probability_pct + '% · ' + (next.opposite_scenario || '') + '</div>'
            : '') +
          '</div>';
      }
      document.getElementById('probs').innerHTML = nextHtml + items.map(([label, p]) => {
        const val = p == null ? 0 : p;
        return '<div class="prob-card"><div class="k">' + label + '</div>' +
          '<div><strong>' + (p == null ? '—' : p + '%') + '</strong></div>' +
          '<div class="bar"><span style="width:' + val + '%"></span></div></div>';
      }).join('');
    }

    async function refresh() {
      document.getElementById('meta').textContent = 'در حال بارگذاری…';
      const [data, candles] = await Promise.all([
        fetch('/api/options-levels?currency=' + encodeURIComponent(currency)).then(r => r.json()),
        loadBinanceCandles(),
      ]);
      if (!data.ok) {
        document.getElementById('meta').textContent = 'خطا: ' + (data.error || 'unknown');
        return;
      }
      series.setData(candles);
      clearLines();
      addLine(data.levels.put_wall, '#42a5f5', 'PUT');
      addLine(data.levels.max_pain, '#ffca28', 'MAX');
      addLine(data.levels.call_wall, '#ef5350', 'CALL');
      chart.timeScale().fitContent();
      renderCards(data);
      const loc = data.probabilities?.spot_location || '';
      document.getElementById('meta').textContent =
        'Expiry ' + data.expiry.token + ' · بروز ' + new Date(data.updated_at).toLocaleString('fa-IR') +
        (loc ? ' · موقعیت: ' + loc : '');
    }

    document.getElementById('refresh').onclick = () => refresh().catch(console.error);
    window.addEventListener('resize', () => chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight }));
    chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
    refresh().catch(err => {
      document.getElementById('meta').textContent = String(err);
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
