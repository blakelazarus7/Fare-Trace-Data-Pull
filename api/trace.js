export default async function handler(req, res) {
  const sku = req.query.sku;
  const AIRTABLE_API_KEY = 'YOUR_KEY_HERE';
  const baseId = 'appXXDxqsKzF2RoF4';
  const table = 'Produce';

  if (!sku) {
    return res.status(400).json({ error: 'Missing SKU in query.' });
  }

  const formula = encodeURIComponent(`{SKU}="${sku}"`);
  const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${formula}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: 'No matching record found.' });
    }

    // Just return the fields
    return res.status(200).json(data.records[0].fields);
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
