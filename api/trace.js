export default async function handler(req, res) {
  const sku = req.query.sku;
  console.log("➡️ SKU from query:", sku);

  const AIRTABLE_API_KEY = "patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a";
  const baseId = "appXXDxqsKzF2RoF4";
  const tableName = "Produce";

  if (!sku) {
    console.log("❌ Missing SKU");
    return res.status(400).json({ error: "Missing SKU in query." });
  }

  const formula = `filterByFormula={SKU}="${sku}"`;
  const url = `https://api.airtable.com/v0/${baseId}/${tableName}?${encodeURI(formula)}`;

  console.log("📡 Fetching Airtable URL:", url);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    console.log("🧾 Airtable Response:", JSON.stringify(data, null, 2));

    if (!data.records || data.records.length === 0) {
      console.log("❌ No matching records found");
      return res.status(404).json({ error: "No matching record found." });
    }

    const record = data.records[0].fields;

    return res.status(200).json({
      name: record["Name"],
      variety: record["SKU Variety"],
      farm: record["SKU Farm"],
      testDate: record["Current COA Test Date"],
      pdf: record["Current COA PDF"]?.[0]?.url || null,
    });
  } catch (error) {
    console.error("🔥 Fetch Error:", error);
    return res.status(500).json({ error: "Failed to fetch from Airtable", details: error.message });
  }
}
