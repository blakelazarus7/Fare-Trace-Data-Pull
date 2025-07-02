export default async function handler(req, res) {
  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const baseId = 'appXXDxqsKzF2RoF4';
  const table = 'Produce';

  if (!sku) {
    return res.status(400).json({ error: 'Missing SKU in query.' });
  }

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${formula}`;

  // 🔥 LOGGING HERE
  console.log("🔥 Running trace.js");
  console.log("👉 SKU received:", sku);
  console.log("🔗 Airtable URL:", url);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    console.log("📦 Airtable response:", JSON.stringify(data, null, 2));

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({
        error: 'No matching record found.',
        debug: {
          sku,
          url,
          airtableResponse: data,
        },
      });
    }

    return res.status(200).json(data.records[0]);
  } catch (err) {
    console.error("❌ Error fetching from Airtable:", err.message);

    return res.status(500).json({
      error: 'Fetch failed',
      detail: err.message,
    });
  }
}
