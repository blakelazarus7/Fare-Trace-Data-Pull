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

  if (!sku) return res.status(400).json({ error: 'Missing SKU in query.' });

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const produceUrl = `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula=${formula}`;

  // ------------------ ADD: helpers for DV + parsing ------------------
  const DV_TABLE = 'Daily Value';

  // Parse "900mcg", "65 g", "2,000kcal" → { amount: 900, unit: 'mcg' }
  function parseAmountUnit(str) {
    if (!str) return { amount: null, unit: '' };
    const s = String(str).trim().replace(/,/g, '');
    const m = s.match(/^([\d.]+)\s*([a-zA-Zµμ]+)?$/);
    if (!m) return { amount: null, unit: '' };
    let unit = (m[2] || '').toLowerCase().replace('µg', 'mcg').replace('μg', 'mcg');
    return { amount: Number(m[1]), unit };
  }

  // Normalize names for soft matching
 function normName(s) {
  if (!s) return '';
  let k = String(s).toLowerCase().trim();

  // drop parentheticals: "Vitamin B6 (Pyridoxine)" -> "Vitamin B6"
  k = k.replace(/\([^)]*\)/g, '').trim();

  // unify common variants
  k = k.replace(/\bvitamin\s*b9\b/g, 'folate');

  // map COA phrases to DV canonical names you use in the table
  k = k.replace(/\btotal\s+fat\b/g, 'fat');
  k = k.replace(/\btotal\s+carbohydrate(s)?\b/g, 'carbohydrate');
  // keep dietary fiber as-is (most DV tables use "Dietary Fiber")
  // sugars: FDA has no %DV for Total Sugars; only map if you add a DV row
  k = k.replace(/\btotal\s+sugars?\b/g, 'total sugars');

  // common short forms
  k = k.replace(/\bcarbs?\b/g, 'carbohydrate');
  k = k.replace(/\bfiber\b/g, 'dietary fiber');
  k = k.replace(/\bsugars?\b/g, 'total sugars');

  // collapse/strip
  k = k.replace(/\s+/g, '');
  k = k.replace(/[^a-z0-9]/g, '');
  return k;
}

  // Basic mass conversions
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
    return value; // kcal, IU, etc → pass through (no %DV calc unless DV uses same unit)
  }

  // Fetch DV table, build soft-match map: normalized name/alias → { amount, unit, displayName }
  async function loadDailyValues() {
    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(DV_TABLE)}`;
    const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' };
    let records = [], offset = null;
    do {
      const url = offset ? `${baseUrl}?offset=${offset}` : baseUrl;
      const resp = await fetch(url, { headers });
      const json = await resp.json();
      records = records.concat(json.records || []);
      offset = json.offset;
    } while (offset);

    const map = new Map();
    for (const r of records) {
      const name = r.fields['Name'];
      const dvStr = r.fields['Daily Value']; // single text like "900mcg", "65g", "2000kcal"
      if (!name || !dvStr) continue;
      const { amount, unit } = parseAmountUnit(dvStr);
      if (amount == null || !unit) continue;

      const entry = { amount, unit, displayName: name };

      // primary key
      map.set(normName(name), entry);

      // optional: support "Aliases" column (comma separated). If you don’t have it, this is harmless.
      const aliases = r.fields['Aliases'];
      if (aliases) {
        String(aliases).split(',').map(s => s.trim()).filter(Boolean).forEach(alias => {
          map.set(normName(alias), entry);
        });
      }

      // a couple of built-in soft synonyms to be safe even without Aliases
      if (/^total carbohydrate$/i.test(name)) {
        map.set(normName('carbohydrates'), entry);
        map.set(normName('carbs'), entry);
      }
      if (/^folate$/i.test(name)) {
        map.set(normName('vitamin b9'), entry);
      }
      if (/^total sugars$/i.test(name)) {
        map.set(normName('sugars'), entry);
        map.set(normName('sugar'), entry);
      }
    }
    return map;
  }

  // Compute %DV using dvMap
  function percentDV(dvMap, name, amount, unit) {
    const dv = dvMap.get(normName(name));
    if (!dv) return null;
    const aligned = convert(Number(amount), unit, dv.unit);
    if (aligned == null || !isFinite(aligned) || dv.amount <= 0) return null;
    return Math.round((aligned / dv.amount) * 100);
  }

  // Parse one comparison line → {name, value, unit}
  function parseComparisonLine(line) {
    // Examples:
    // "Vitamin C: 18mg (⬇️ lower than baseline 58mg)"
    // "Potassium: 350mg (⬆️ higher than baseline 120mg)"
    // "Calories: 15kcal (⬇️ lower than baseline 32kcal)"
    const m = String(line).match(/^([^:]+):\s*([\d.]+)\s*([a-zA-Zµμ]+)\b/);
    if (!m) return null;
    let name = m[1].trim();
    let val = Number(m[2]);
    let unit = m[3].toLowerCase().replace('µg', 'mcg').replace('μg', 'mcg');
    return { name, value: val, unit };
  }
  // ------------------ END helpers ------------------

  try {
    // 1️⃣ Fetch Produce record by SKU
    const produceResponse = await fetch(produceUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const produceData = await produceResponse.json();

    if (!produceData.records || produceData.records.length === 0) {
      return res.status(404).json({ error: 'No matching record found.' });
    }

    const record = produceData.records[0].fields;

    // ➕ ADD: load Daily Values once
    const dvMap = await loadDailyValues();

    // ➕ ADD: build clean nutrients array from "Nutrient Comparison"
    const comparisonText = record["Nutrient Comparison"] || "";
    const nutrients = String(comparisonText)
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(parseComparisonLine)
      .filter(Boolean)
      .map(({ name, value, unit }) => {
        const dvPct = percentDV(dvMap, name, value, unit);
        return {
          name,
          value,
          unit,
          amount: `${value}${unit}`,
          dvPercent: dvPct
        };
      });

    // 2️⃣ Defaults for farm fields
    let farmCertifications = [];
    let farmOwnership = [];
    let farmAcres = null;
    let farmYearCertified = null;

    // 3️⃣ Fetch linked farm record from "SKU Farm"
    if (record["SKU Farm"] && Array.isArray(record["SKU Farm"]) && record["SKU Farm"].length > 0) {
      const farmId = record["SKU Farm"][0];
      const farmUrl = `https://api.airtable.com/v0/${baseId}/${farmsTable}/${farmId}`;

      const farmResponse = await fetch(farmUrl, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const farmData = await farmResponse.json();

      if (farmData && farmData.fields) {
        farmCertifications = Array.isArray(farmData.fields["Certifications"]) ? farmData.fields["Certifications"] : [];
        farmOwnership = Array.isArray(farmData.fields["Ownership"]) ? farmData.fields["Ownership"] : [];
        farmAcres = typeof farmData.fields["Acres"] === "number" ? farmData.fields["Acres"] : null;
        farmYearCertified = typeof farmData.fields["Year Certified"] === "number" ? farmData.fields["Year Certified"] : null;
      }
    }

    // 4️⃣ Send response — keep everything, just ADD `nutrients`
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
        // keep raw comparisons if you still want them
        "Nutrient Comparison": record["Nutrient Comparison"] || "",
        // ➕ computed, clean output for Replo (amount + %DV, no arrows)
        nutrients
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
