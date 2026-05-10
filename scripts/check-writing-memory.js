const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  getWritingLessonsForCategory,
  getWritingLessonsForField,
  recordApprovedWritingEdit,
  rejectUnsafeWritingMemory,
  sanitizeWritingMemoryRecord,
  summarizeWritingLesson,
} = require("../lib/article-agents/writing-memory");

const failures = [];
const storePath = path.join(os.tmpdir(), "live-news-writing-memory-check.json");

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function resetStore() {
  try {
    fs.unlinkSync(storePath);
  } catch {
    // The check uses a temp store so repeated local runs stay clean.
  }
}

resetStore();

const safeSportsEdit = {
  storyId: "ln-memory-sports-1",
  category: "Sports",
  fieldName: "description",
  weakOutput: "The game is getting attention from fans.",
  approvedOutput: "The Lakers and Warriors matchup drew attention after both teams entered the series with playoff pressure.",
  editorReason: "Needed teams, matchup context, and why the story mattered.",
  sourceSafetyNotes: ["Teams and playoff context were source-backed."],
  createdAt: "2026-05-10T15:00:00.000Z",
};

const stored = recordApprovedWritingEdit(safeSportsEdit, { storePath });
expect(stored.ok, "Approved edit should be stored.");
expect(stored.record?.fieldName === "description", "Stored edit should preserve normalized field name.");
expect(stored.record?.lesson.includes("sports matchups"), "Safe sports lesson should be generated.");

const usernameRejected = recordApprovedWritingEdit(
  {
    ...safeSportsEdit,
    storyId: "ln-memory-unsafe-username",
    editorReason: "Use the angle from @readername because it got attention.",
  },
  { storePath }
);
expect(usernameRejected.rejected, "Username should be rejected or removed before memory storage.");
expect(usernameRejected.reasons.join(" ").includes("username"), "Username rejection should explain the reason.");

const privateMessageRejected = rejectUnsafeWritingMemory({
  ...safeSportsEdit,
  storyId: "ln-memory-unsafe-private-message",
  editorReason: "A private message said this angle worked.",
});
expect(privateMessageRejected.rejected, "Private message text should be rejected.");

const commentRejected = sanitizeWritingMemoryRecord({
  ...safeSportsEdit,
  storyId: "ln-memory-unsafe-comment",
  editorReason: "A commenter said to use this phrasing.",
});
expect(commentRejected.rejected, "Copied comment text should be rejected.");

const publisherRejected = recordApprovedWritingEdit(
  {
    storyId: "ln-memory-publisher-copy",
    category: "Local",
    fieldName: "title",
    weakOutput: "City leaders approve overnight transit safety plan after public review",
    approvedOutput: "City leaders approve overnight transit safety plan after public review",
    editorReason: "Keep the publisher wording.",
    publisherText: "City leaders approve overnight transit safety plan after public review",
  },
  { storePath }
);
expect(publisherRejected.rejected, "Publisher wording should not be learned as a preferred pattern.");
expect(
  publisherRejected.reasons.join(" ").includes("publisher_wording_too_close"),
  "Publisher wording rejection should be explicit."
);

const localLesson = summarizeWritingLesson({
  category: "Local",
  fieldName: "summary",
  editorReason: "Added the neighborhood and resident impact.",
});
expect(localLesson.includes("location"), "Safe local lesson should mention source-backed location.");

const categoryLessons = getWritingLessonsForCategory("sports", { storePath });
expect(categoryLessons.length === 1, "Similar category should retrieve stored lesson.");
expect(categoryLessons[0].lesson.includes("teams or players"), "Retrieved category lesson should be safe and useful.");

const fieldLessons = getWritingLessonsForField("description", { storePath });
expect(fieldLessons.length === 1, "Similar field should retrieve stored lesson.");
expect(fieldLessons[0].approvedOutput.includes("Lakers"), "Retrieved field lesson should preserve editor-approved output.");

if (failures.length) {
  console.error("Live News writing memory check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  resetStore();
  process.exit(1);
}

console.log("Live News writing memory check passed.");
console.log(`Example safe lesson: ${stored.record.lesson}`);
console.log(`Example unsafe rejection: ${publisherRejected.reasons.join(", ")}`);
resetStore();
