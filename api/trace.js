export default async function handler(req, res) {
  // ✅ Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const baseId = 'appXXDxqsKzF2RoF4';
  const produceTable = 'Produce';
  const farmsTable = 'Farms';

  if (!sku) {
    return res.status(400).json({ error: 'Missing SKU in query.' });
  }

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const produceUrl = `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula=${formula}`;

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

    // 2️⃣ Default farm fields (in case farm not found)
    let farmCertifications = [];
    let farmOwnership = [];
    let farmAcres = null;
    let farmYearCertified = null;

    // 3️⃣ Fetch linked farm record from "SKU Farm"
    if (record["SKU Farm"] && Array.isArray(record["SKU Farm"]) && record["SKU Farm"].length > 0) {
      const farmId = record["SKU Farm"][0]; // First linked farm ID
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

    // 4️⃣ Send response
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
        farmYearCertified
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
