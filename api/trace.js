export default async function handler(req, res) {
  const { sku } = req.query;
  const AIRTABLE_TOKEN = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const BASE_ID = 'appXXDxqsKzF2RoF4';
  const TABLE_NAME = 'Produce';

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?filterByFormula=({SKU Slug}="${sku}")`;

  try {
    const airtableRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const json = await airtableRes.json();
    if (!json.records || json.records.length === 0) {
      return res.status(404).json({ error: 'No matching record found.' });
    }

    const record = json.records[0].fields;
    res.status(200).json({
      name: record['Name'],
      variety: record['SKU Variety'],
      farm: record['SKU Farm'][0], // ID or text
      testDate: record['Current COA Test Date'],
      pdf: record['Current COA PDF']?.[0]?.url || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch from Airtable', details: err.message });
  }
}
