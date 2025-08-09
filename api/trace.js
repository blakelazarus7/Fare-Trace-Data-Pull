export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const baseId = 'appXXDxqsKzF2RoF4';
  const produceTable = 'Produce';
  const farmsTable = 'Farms';
  const DV_TABLE = 'Daily Value';

  if (!sku) return res.status(400).json({ error: 'Missing SKU in query.' });

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const produceUrl = `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula=${formula}`;

  // ---------------- helpers (tiny, generic, no hardcoding of names) ----------------

  // Parse "900mcg", "65 g", "2,000kcal" → { amount, unit }
  function parseAmountUnit(str) {
    if (!str) return { amount: null, unit: '' };
    const s = String(str).trim().replace(/,/g, '');
    const m = s.match(/^([\d.]+)\s*([a-zA-Zµμ]+)?$/);
    if (!m) return { amount: null, unit: '' };
    let unit = (m[2] || '').toLowerCase().replace('µg', 'mcg').replace('μg', 'mcg');
    return { amount: Number(m[1]), unit };
  }

  // Levenshtein distance (small, iterative)
  function lev(a, b) {
    a = a || ''; b = b || '';
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0], cur;
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        cur = (a[i - 1] === b[j - 1]) ? prev : Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
        dp[j] = cur; prev = tmp;
      }
    }
    return dp[n];
  }

  // Tokenizer with stopword removal + light singularization
  const STOP = new Set([
    'total','dietary','added','soluble','insoluble','free','of','the','and','per'
  ]);
  function tokens(s) {
    const base = String(s || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')    // drop parentheticals
      .replace(/vit\s*/g, 'vitamin ') // normalize "vit" → "vitamin"
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const raw = base.split(/\s+/).filter(Boolean);
    return raw
      .filter(t => !STOP.has(t))
      .map(t => t.replace(/s\b/, '')) // sugars→sugar, carbohydrates→carbohydrate
      .filter(Boolean);
  }

  // Jaccard overlap of two token sets
  function jaccard(aTokens, bTokens) {
    const A = new Set(aTokens), B = new Set(bTokens);
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = new Set([...A, ...B]).size || 1;
    return inter / union;
  }

  // Unit conversion for mass (g/mg/mcg); others pass through
  function convert(value, from, to) {
    if (value == null || isNaN(value)) return null;
    const f = (from || '').toLowerCase(), t = (to || '').toLowerCase();
    if (!f || !t || f === t) return value;
    if (f === 'g'   && t === 'mg')  return value * 1000;
    if (f === 'mg'  && t === 'g')   return value / 1000;
    if (f === 'mg'  && t === 'mcg') return value * 1000;
    if (f === 'mcg' && t === 'mg')  return value / 1000;
    if (f === 'g'   && t === 'mcg') return value * 1_000_000;
    if (f === 'mcg' && t === 'g')   return value / 1_000_000;
    return value; // kcal, IU, etc.
  }

  // Load DV rows; return an array of entries, each with candidate names for matching
  async function loadDailyValues() {
    const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' };
    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(DV_TABLE)}`;
    let records = [], offset = null;
    do {
      const url = offset ? `${baseUrl}?offset=${offset}` : baseUrl;
      const resp = await fetch(url, { headers });
      const json = await resp.json();
      records = records.concat(json.records || []);
      offset = json.offset;
    } while (offset);

    return records
      .map(r => {
        const name = r.fields['Name'];
        const dvStr = r.fields['Daily Value'];
        if (!name || !dvStr) return null;
        const { amount, unit } = parseAmountUnit(dvStr);
        if (amount == null || !unit) return null;

        // candidate names: Name + any Aliases
        const aliases = String(r.fields['Aliases'] || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        const cand = [name, ...aliases];

        return {
          displayName: name,
          amount,
          unit: unit.toLowerCase(),
          nameTokensList: cand.map(tokens) // pre-tokenize candidates
        };
      })
      .filter(Boolean);
  }

  // Fuzzy match a COA nutrient name to best DV entry (score by tokens + levenshtein)
  function matchDV(dvEntries, rawName) {
    const tA = tokens(rawName);
    const keyA = tA.join(''); // for levenshtein baseline
    let best = null;
    let bestScore = 0;

    for (const entry of dvEntries) {
      for (const tB of entry.nameTokensList) {
        const keyB = tB.join('');
        const jac = jaccard(tA, tB);                 // 0..1
        const levDist = lev(keyA, keyB);
        const levSim = keyA.length + keyB.length
          ? 1 - levDist / Math.max(keyA.length, keyB.length)
          : 0;
        // blend (tuneable)
        const score = 0.7 * jac + 0.3 * levSim;

        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
    }

    // require decent overlap; tweak threshold if needed
    return bestScore >= 0.55 ? best : null;
  }

  // Parse one comparison line → {name, value, unit}
  function parseComparisonLine(line) {
    // e.g. "Dietary Fiber: 2g (…)", "Vitamin B6 (Pyridoxine): 0.1mg (…)”
    const m = String(line).match(/^([^:]+):\s*([\d.]+)\s*([a-zA-Zµμ]+)\b/);
    if (!m) return null;
    let name = m[1].trim();
    let val  = Number(m[2]);
    let unit = m[3].toLowerCase().replace('µg', 'mcg').replace('μg', 'mcg');
    return { name, value: val, unit };
  }

  function percentDV(dvEntry, value, unit) {
    if (!dvEntry) return null;
    const aligned = convert(Number(value), unit, dvEntry.unit);
    if (aligned == null || !isFinite(aligned) || dvEntry.amount <= 0) return null;
    return Math.round((aligned / dvEntry.amount) * 100);
  }

  // -----------------------------------------------------------------------------

  try {
    // Fetch Produce record
    const produceResponse = await fetch(produceUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    });
    const produceData = await produceResponse.json();

    if (!produceData.records || produceData.records.length === 0) {
      return res.status(404).json({ error: 'No matching record found.' });
    }

    const record = produceData.records[0].fields;

    // Load DV entries (once)
    const dvEntries = await loadDailyValues();

    // Build clean nutrients array from "Nutrient Comparison"
    const comparisonText = record["Nutrient Comparison"] || "";
    const nutrients = String(comparisonText)
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(parseComparisonLine)
      .filter(Boolean)
      .map(({ name, value, unit }) => {
        const dvEntry = matchDV(dvEntries, name);
        const dvPct = percentDV(dvEntry, value, unit);
        return {
          name,
          value,
          unit,
          amount: `${value}${unit}`,
          dvPercent: dvPct
        };
      });

    // Defaults for farm fields
    let farmCertifications = [];
    let farmOwnership = [];
    let farmAcres = null;
    let farmYearCertified = null;

    // Fetch linked farm record
    if (record["SKU Farm"] && Array.isArray(record["SKU Farm"]) && record["SKU Farm"].length > 0) {
      const farmId = record["SKU Farm"][0];
      const farmUrl = `https://api.airtable.com/v0/${baseId}/${farmsTable}/${farmId}`;

      const farmResponse = await fetch(farmUrl, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      });
      const farmData = await farmResponse.json();

      if (farmData && farmData.fields) {
        farmCertifications = Array.isArray(farmData.fields["Certifications"]) ? farmData.fields["Certifications"] : [];
        farmOwnership = Array.isArray(farmData.fields["Ownership"]) ? farmData.fields["Ownership"] : [];
        farmAcres = typeof farmData.fields["Acres"] === "number" ? farmData.fields["Acres"] : null;
        farmYearCertified = typeof farmData.fields["Year Certified"] === "number" ? farmData.fields["Year Certified"] : null;
      }
    }

    // Optional debug dump to see matches/thresholds
    let debug = undefined;
    if (req.query.debug === '1') {
      debug = nutrients.map(n => {
        const dvEntry = matchDV(dvEntries, n.name);
        return {
          name: n.name,
          tokens: tokens(n.name),
          matchedDV: dvEntry ? { name: dvEntry.displayName, amount: dvEntry.amount, unit: dvEntry.unit } : null,
          value: n.value,
          unit: n.unit,
          dvPercent: n.dvPercent
        };
      });
    }

    // Respond
    res.status(200).json({
      success: true,
      data: {
        name: record.Name,
        variety: record["SKU Variety"],
        location: record["Farm Location"],
        coaDate: record["Current COA Test Date"],
        image: record.Photo?.[0]?.url || "",
        videos: record["Videos"]
          ? record["Videos"].split(/[\n\s]+/).map(s => s.trim()).filter(Boolean)
          : [],
        farmCertifications,
        farmOwnership,
        farmAcres,
        farmYearCertified,
        "Nutrient Comparison": record["Nutrient Comparison"] || "",
        nutrients,
        debug
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
