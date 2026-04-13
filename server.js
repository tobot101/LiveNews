const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;
const dataPath = path.join(__dirname, "data", "news.json");

function loadNews() {
  const raw = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(raw);
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", (req, res) => {
  const data = loadNews();
  res.json({
    updatedAt: new Date().toISOString(),
    ...data,
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
