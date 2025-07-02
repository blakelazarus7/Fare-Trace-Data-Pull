export default async function handler(req, res) {
  const { sku } = req.query;

  const AIRTABLE_TOKEN = 'patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a';
  const BASE_ID = 'appXXDxqsKzF2RoF4';
  const TABLE_NAME = 'Produce';

  const filterFormula = `filterByFormula=${encodeURIComponent(`{SKU Slug} = '${sku}'`)}`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?${filterFormula}`;

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
      farm: typeof record['SKU Farm'] === 'string' ? record['SKU Farm'] : record['SKU Farm']?.[0] || null,
      testDate: record['Current COA Test Date'],
      pdf: record['Current COA PDF']?.[0]?.url || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch from Airtable', details: err.message });
  }
}
