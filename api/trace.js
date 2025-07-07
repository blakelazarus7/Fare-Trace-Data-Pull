export default async function handler(req, res) {
  const sku = req.query.sku;

  const AIRTABLE_API_KEY = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const baseId = 'appXXDxqsKzF2RoF4';
  const table = 'Produce';

  if (!sku) {
    return res.status(400).json({ error: '❌ Missing SKU in query.' });
  }

  const formula = `filterByFormula=${encodeURIComponent(`{SKU}="${sku}"`)}`;
  const url = `https://api.airtable.com/v0/${baseId}/${table}?${formula}`;

  try {
    console.log('📡 Requesting Airtable with:', sku);
    console.log('🔗 Full URL:', url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: '❌ Airtable request failed', detail: errorText });
    }

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: '❌ No matching record found for that SKU.', debug: { sku } });
    }

    return res.status(200).json({ success: true, record: data.records[0] });
  } catch (error) {
    console.error('💥 Airtable fetch error:', error);
    return res.status(500).json({ error: '❌ Server error', detail: error.message });
  }
}
