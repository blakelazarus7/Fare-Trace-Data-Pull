export default async function handler(req, res) {
  const sku = req.query.sku;
  const AIRTABLE_API_KEY = "patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a";

  if (!sku) {
    return res.status(400).json({ error: "Missing SKU in query." });
  }

  const baseId = "appXXDxqsKzF2RoF4";
  const tableName = "Produce";
  const formula = encodeURIComponent(`{SKU}='${sku}'`);
  const url = `https://api.airtable.com/v0/${baseId}/${tableName}?filterByFormula=${formula}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: "No matching record found." });
    }

    return res.status(200).json(data.records[0]);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch from Airtable." });
  }
}
