export default async function handler(req, res) {
  // ✅ Set proper CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  // ✅ Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const baseId = 'appXXDxqsKzF2RoF4';
  const table = 'Produce';

  if (!sku) {
    return res.status(400).json({ error: 'Missing SKU in query.' });
  }

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${formula}&expand=SKU%20Farm`;


  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: 'No matching record found.', debug: { sku, url } });
    }

    return res.status(200).json(data.records[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
