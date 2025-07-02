export default async function handler(req, res) {
  const { sku } = req.query;

  if (!sku) {
    return res.status(400).json({ error: "SKU parameter is required" });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const baseId = "appXXXXXXXXXXXXXX"; // Replace with your actual Airtable base ID
  const table = "Produce";

  const formula = `SKU="${sku}"`;
  const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1&view=Grid%20view&expand=SKU%20Farm`;

  try {
    const airtableRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const json = await airtableRes.json();

    if (!json.records || json.records.length === 0) {
      return res.status(404).json({ error: "SKU not found" });
    }

    const record = json.records[0];
    const fields = record.fields;

    // ✅ Use exact field name: "Farm Location"
    let farmLocation = "Unknown";
    if (fields["SKU Farm"] && Array.isArray(fields["SKU Farm"])) {
      const farm = fields["SKU Farm"][0];
      if (farm.fields && farm.fields["Farm Location"]) {
        farmLocation = farm.fields["Farm Location"];
      }
    }

    res.status(200).json({
      fields: {
        ...fields,
        FarmLocation: farmLocation
      }
    });
  } catch (error) {
    console.error("Airtable fetch error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
