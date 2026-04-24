const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_PATHS = {
  packets: path.join(DATA_DIR, "story-packets.json"),
  drafts: path.join(DATA_DIR, "drafts.json"),
  approvedStories: path.join(DATA_DIR, "approved-stories.json"),
  feedback: path.join(DATA_DIR, "editor-feedback.json"),
  styleMemory: path.join(DATA_DIR, "style-memory.json"),
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function readStyleMemory() {
  return readJson(STORE_PATHS.styleMemory, {
    schemaVersion: "live-news-style-memory-v1",
    recentFingerprints: [],
    avoidPhrases: [],
    editorLessons: [],
  });
}

function saveAgentRun({ packets, drafts, run }) {
  const updatedAt = new Date().toISOString();
  writeJson(STORE_PATHS.packets, {
    schemaVersion: "live-news-story-packets-store-v1",
    updatedAt,
    run,
    packets,
  });
  writeJson(STORE_PATHS.drafts, {
    schemaVersion: "live-news-drafts-store-v1",
    mode: "review_only",
    autoPublish: false,
    updatedAt,
    run,
    drafts,
  });
  updateStyleMemory(drafts);
}

function updateStyleMemory(drafts) {
  const current = readStyleMemory();
  const fingerprints = drafts
    .map((draft) => draft.styleFingerprint)
    .filter(Boolean)
    .map((fingerprint) => ({
      ...fingerprint,
      storyId: fingerprint.storyId,
      recordedAt: new Date().toISOString(),
    }));
  const recentFingerprints = [...fingerprints, ...(current.recentFingerprints || [])].slice(0, 50);
  writeJson(STORE_PATHS.styleMemory, {
    ...current,
    updatedAt: new Date().toISOString(),
    recentFingerprints,
  });
}

module.exports = {
  STORE_PATHS,
  readJson,
  readStyleMemory,
  saveAgentRun,
  writeJson,
};
