export default async function handler(req, res) {
  const { sku } = req.query;

  if (!sku) {
    return res.status(400).json({ error: "Missing SKU parameter" });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = "appXXDxqsKzF2RoF4"; // your actual base ID
  const TABLE_NAME = "Produce";

  const filterFormula = encodeURIComponent(`{SKU}='${sku}'`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?filterByFormula=${filterFormula}`;

  try {
    const airtableRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const data = await airtableRes.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: "No matching record found." });
    }

    const record = data.records[0].fields;

    res.status(200).json({ record });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
}
