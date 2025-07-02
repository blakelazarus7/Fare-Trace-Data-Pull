export default async function handler(req, res) {
  const sku = req.query.sku;
  console.log("➡️ Incoming request with SKU:", sku);

  const AIRTABLE_API_KEY = "patX9RAJJXpjbOq05.9a2ae2b9e396d5abfb7fe8e894e55321abbcb30db9d77932bff5b0418c41f21a";
  const baseId = "appXXDxqsKzF2RoF4";
  const tableName = "Produce";

  if (!sku) {
    console.error("❌ Missing SKU query param");
    return res.status(400).json({ error: "Missing SKU in query." });
  }

  const formula = `{SKU}="${sku}"`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${baseId}/${tableName}?filterByFormula=${encodedFormula}`;

  console.log("🔗 Airtable URL:", url);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log("📬 Airtable response status:", response.status);
    const data = await response.json();
    console.log("📦 Airtable response body:", JSON.stringify(data, null, 2));

    if (!data.records || data.records.length === 0) {
      console.warn("⚠️ No matching records found in Airtable.");
      return res.status(404).json({ error: "No matching record found." });
    }

    const record = data.records[0];
    console.log("✅ Found record:", record);

    return res.status(200).json(record);
  } catch (error) {
    console.error("🔥 Failed to fetch from Airtable:", error);
    return res.status(500).json({
      error: "Failed to fetch from Airtable.",
      details: error.message,
    });
  }
}
