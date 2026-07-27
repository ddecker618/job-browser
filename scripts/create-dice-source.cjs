const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'data', 'desktop-dev', 'data', 'jobs.sqlite');
const db = new Database(dbPath);

const existing = db.prepare("SELECT id FROM sources WHERE provider_id = 'dice'").all();

if (existing.length > 0) {
  const diceId = existing[0].id;
  const config = JSON.stringify({
    searchKeywords: "systems administrator",
    location: "Remote",
    remoteFilter: "remote",
    datePosted: "any",
    maxResults: 50,
    keepBrowserOpen: false,
    debugMode: false,
    queries: [
      { keywords: "systems administrator", location: "Remote" },
      { keywords: "network analyst", location: "Remote" }
    ]
  });
  const searchCriteria = JSON.stringify({
    query: "systems administrator",
    location: "Remote",
    remoteOnly: true,
    limit: 50
  });
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sources SET
      employer = ?, display_name = ?, configuration_json = ?,
      search_criteria_json = ?, configuration_status = ?, updated_at = ?
    WHERE id = ?
  `).run("Dice", "Dice", config, searchCriteria, "valid", now, diceId);
  console.log("Updated existing Dice source: " + diceId);
} else {
  const config = JSON.stringify({
    searchKeywords: "systems administrator",
    location: "Remote",
    remoteFilter: "remote",
    datePosted: "any",
    maxResults: 50,
    keepBrowserOpen: false,
    debugMode: false,
    queries: [
      { keywords: "systems administrator", location: "Remote" },
      { keywords: "network analyst", location: "Remote" }
    ]
  });
  const searchCriteria = JSON.stringify({
    query: "systems administrator",
    location: "Remote",
    remoteOnly: true,
    limit: 50
  });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sources (id, source_type, employer, display_name, provider_id, careers_url, enabled, configuration_json, search_criteria_json, configuration_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "provider:dice",
    "job-board",
    "Dice",
    "Dice",
    "dice",
    "https://www.dice.com",
    0,
    config,
    searchCriteria,
    "valid",
    now,
    now
  );
  console.log("Created new Dice source");
}

const dice = db.prepare("SELECT id, display_name, configuration_json, enabled FROM sources WHERE provider_id = 'dice'").all();
console.log("Dice source now:", JSON.stringify(dice, null, 2));
db.close();
