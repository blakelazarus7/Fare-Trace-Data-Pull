export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'YOUR_AIRTABLE_PAT_HERE'; // keep yours
  const baseId = 'appXXDxqsKzF2RoF4';
  const produceTable = 'Produce';
  const farmsTable = 'Farms';

  if (!sku) return res.status(400).json({ error: 'Missing SKU in query.' });

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const produceUrl = `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula=${formula}`;

  try {
    // Fetch Produce record
    const produceResponse = await fetch(produceUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const produceData = await produceResponse.json();
    if (!produceData.records?.length) {
      return res.status(404).json({ error: 'No matching record found.' });
    }

    const record = produceData.records[0].fields;

    // ====== DV MAP (single source of truth) ======
    // Units are the canonical DV units from FDA (Adults/Children ≥4y, 2,000 kcal diet).
    // Use these keys exactly as they appear in your "Nutrient Comparison" names if possible.
    const DV = {
      // Macros
      'Total Fat':        { value: 78,   unit: 'g'   },
      'Sodium':           { value: 2300, unit: 'mg'  },
      'Total Carbohydrate': { value: 275, unit: 'g'  },
      'Dietary Fiber':    { value: 28,   unit: 'g'   },
      // Protein DV not required by FDA for adults; leave undefined or set if you prefer:
      // 'Protein':       { value: 50, unit: 'g' },

      // Vitamins (RDI)
      'Vitamin A':        { value: 900,  unit: 'mcg' }, // RAE
      'Vitamin C':        { value: 90,   unit: 'mg'  },
      'Vitamin D':        { value: 20,   unit: 'mcg' },
      'Vitamin E':        { value: 15,   unit: 'mg'  },
      'Vitamin K':        { value: 120,  unit: 'mcg' },
      'Thiamin':          { value: 1.2,  unit: 'mg'  },
      'Riboflavin':       { value: 1.3,  unit: 'mg'  },
      'Niacin':           { value: 16,   unit: 'mg'  },
      'Vitamin B6':       { value: 1.7,  unit: 'mg'  },
      'Folate':           { value: 400,  unit: 'mcg' },
      'Vitamin B12':      { value: 2.4,  unit: 'mcg' },
      'Biotin':           { value: 30,   unit: 'mcg' },
      'Pantothenic Acid': { value: 5,    unit: 'mg'  },
      'Choline':          { value: 550,  unit: 'mg'  },

      // Minerals
      'Calcium':          { value: 1300, unit: 'mg'  },
      'Iron':             { value: 18,   unit: 'mg'  },
      'Magnesium':        { value: 420,  unit: 'mg'  },
      'Phosphorus':       { value: 1250, unit: 'mg'  },
      'Potassium':        { value: 4700, unit: 'mg'  },
      'Zinc':             { value: 11,   unit: 'mg'  },
      'Selenium':         { value: 55,   unit: 'mcg' },
      'Copper':           { value: 0.9,  unit: 'mg'  },
      'Manganese':        { value: 2.3,  unit: 'mg'  },
      'Iodine':           { value: 150,  unit: 'mcg' },
      'Chromium':         { value: 35,   unit: 'mcg' },
      'Molybdenum':       { value: 45,   unit: 'mcg' },
    };

    // Unit conversion helpers
    const toUnit = (value, from, to) => {
      if (value == null || isNaN(value)) return null;
      const f = (from || '').toLowerCase();
      const t = (to || '').toLowerCase();
      if (f === t) return value;

      // mass conversions
      const gToMg = v => v * 1000;
      const mgToG = v => v / 1000;
      const mgToMcg = v => v * 1000;
      const mcgToMg = v => v / 1000;
      const gToMcg = v => v * 1_000_000;
      const mcgToG = v => v / 1_000_000;

      // simple matrix
      if (f === 'g' && t === 'mg')  return gToMg(value);
      if (f === 'mg' && t === 'g')  return mgToG(value);
      if (f === 'mg' && t === 'mcg') return mgToMcg(value);
      if (f === 'mcg' && t === 'mg') return mcgToMg(value);
      if (f === 'g' && t === 'mcg')  return gToMcg(value);
      if (f === 'mcg' && t === 'g')  return mcgToG(value);

      // calories etc (no conversion)
      return value;
    };

    const percentDV = (name, value, unit) => {
      const dv = DV[name];
      if (!dv || value == null) return null;
      const aligned = toUnit(Number(value), unit, dv.unit);
      if (aligned == null || dv.value <= 0) return null;
      return Math.round((aligned / dv.value) * 100);
    };

    // Parse your "Nutrient Comparison" lines → {name, value, unit}
    const comparisonText = record["Nutrient Comparison"] || "";
    const nutrientLines = String(comparisonText)
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const parsedNutrients = nutrientLines.map(line => {
      // examples:
      // "Vitamin C: 18mg (⬇️ lower than baseline 58mg)"
      // "Potassium: 350mg (⬆️ higher than baseline 120mg)"
      // "Calories: 15kcal (⬇️ lower than baseline 32kcal)"
      const m = line.match(/^([^:]+):\s*([\d.]+)\s*([a-zA-Zµ]+)\b/);
      if (!m) return null;
      const nameRaw = m[1].trim();
      let unit = m[3].toLowerCase();
      let value = Number(m[2]);

      // Normalize some units (µg → mcg)
      if (unit.includes('µg')) unit = 'mcg';
      if (unit === 'kcal') {
        // We don't compute DV% for calories here, but still return as-is
        return {
          name: 'Calories',
          value,
          unit: 'kcal',
          amount: `${value}kcal`,
          dvPercent: null
        };
      }

      // Compute DV% if we have a DV entry for that nutrient label
      // Try exact name first; also try Title Case for keys to match DV map
      const titleName = nameRaw.replace(/\b\w/g, c => c.toUpperCase());
      const nameForDV = DV[nameRaw] ? nameRaw : (DV[titleName] ? titleName : nameRaw);

      const dvPct = percentDV(nameForDV, value, unit);

      return {
        name: titleName,
        value,
        unit,
        amount: `${value}${unit}`,
        dvPercent: dvPct
      };
    }).filter(Boolean);

    // ===== Farm extras (unchanged) =====
    let farmCertifications = [];
    let farmOwnership = [];
    let farmAcres = null;
    let farmYearCertified = null;

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

      if (farmData?.fields) {
        farmCertifications = Array.isArray(farmData.fields["Certifications"]) ? farmData.fields["Certifications"] : [];
        farmOwnership = Array.isArray(farmData.fields["Ownership"]) ? farmData.fields["Ownership"] : [];
        farmAcres = typeof farmData.fields["Acres"] === "number" ? farmData.fields["Acres"] : null;
        farmYearCertified = typeof farmData.fields["Year Certified"] === "number" ? farmData.fields["Year Certified"] : null;
      }
    }

    // Response (keep your old fields; ADD clean nutrients + still include raw string)
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

        // NEW: machine-friendly nutrients (clean)
        nutrients: parsedNutrients, // [{ name, value, unit, amount: "18mg", dvPercent: 20 }, ...]

        // Keep raw string if you still want it elsewhere
        "Nutrient Comparison": comparisonText
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
