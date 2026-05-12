const { escapeHtml } = require("./story-renderer");
const { cleanText } = require("./text-utils");
const {
  buildStoryWritingPackage,
  detectCopyRisk,
  detectFallbackRisk,
} = require("./writing-quality");

const EDITABLE_FIELDS = [
  { fieldName: "title", label: "Approved editor title", bodyName: "approvedTitle" },
  { fieldName: "description", label: "Approved editor description", bodyName: "approvedDescription", multiline: true },
  { fieldName: "summary", label: "Approved editor summary", bodyName: "approvedSummary", multiline: true },
  { fieldName: "whyItMatters", label: "Approved why it matters", bodyName: "approvedWhyItMatters", multiline: true },
];

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function getWritingPackage(draft, validation = {}) {
  return validation.writingPackage || draft.writingQuality || buildStoryWritingPackage(draft);
}

function getDraftFieldValue(draft, fieldName) {
  if (fieldName === "title") return cleanText(draft.headline || draft.title);
  if (fieldName === "description") return cleanText(draft.description || draft.dek);
  if (fieldName === "summary") return asList(draft.summary).map(cleanText).filter(Boolean).join(" ");
  if (fieldName === "whyItMatters") return cleanText(draft.whyItMatters);
  return cleanText(draft[fieldName]);
}

function getPackageFieldValue(writingPackage, draft, fieldName) {
  if (fieldName === "title") return cleanText(writingPackage.title || getDraftFieldValue(draft, fieldName));
  if (fieldName === "description") return cleanText(writingPackage.description || getDraftFieldValue(draft, fieldName));
  if (fieldName === "summary") return cleanText(writingPackage.summary || getDraftFieldValue(draft, fieldName));
  if (fieldName === "whyItMatters") return cleanText(writingPackage.whyItMatters || getDraftFieldValue(draft, fieldName));
  return cleanText(writingPackage[fieldName] || getDraftFieldValue(draft, fieldName));
}

function scoreLabel(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "n/a";
  return `${Math.round(Number(value))}`;
}

function renderList(items, emptyLabel) {
  const values = asList(items).map(cleanText).filter(Boolean);
  if (!values.length) return `<p class="writing-muted">${escapeHtml(emptyLabel)}</p>`;
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function teacherFailed(teacher = {}) {
  return teacher.blocking || teacher.passed === false || Number(teacher.score || 0) < 70;
}

function failedTeacherNamesFromChecks(checks = []) {
  return asList(checks)
    .filter(teacherFailed)
    .map((teacher) => cleanText(teacher.name || teacher.id || teacher.fieldName || "Teacher"))
    .filter(Boolean);
}

function copyRiskLabel(copyRisk = {}) {
  const risk = cleanText(copyRisk.risk || copyRisk.severity || "unknown");
  const score = Number.isFinite(Number(copyRisk.score)) ? ` · score ${Math.round(Number(copyRisk.score))}` : "";
  return `${risk || "unknown"}${score}`;
}

function copyRiskExplanation(copyRisk = {}) {
  return cleanText(
    copyRisk.explanation ||
      copyRisk.reason ||
      (copyRisk.reasons || []).join(" ") ||
      "No copy-risk explanation available."
  );
}

function findCandidateScoreByText(candidates = [], text = "") {
  const requested = cleanText(text);
  if (!requested) return 0;
  const match = asList(candidates).find((candidate) => cleanText(candidate.text) === requested);
  return Number(match?.writingExam?.total || match?.evaluation?.exam?.total || 0);
}

function summarizeRewriteStatus(room = {}) {
  const session = room.rewriteSession || {};
  const selected = room.selectedCandidate || {};
  const attempts = asList(session.attempts);
  const firstAttempt = attempts[0] || {};
  const failedTeacherNames = asList(firstAttempt.diagnosis?.failedTeacherNames).length
    ? asList(firstAttempt.diagnosis.failedTeacherNames).map(cleanText).filter(Boolean)
    : failedTeacherNamesFromChecks(selected.teacherChecks || []);
  const rewriteStrategyUsed = asList(firstAttempt.diagnosis?.strategies || firstAttempt.rewritePlan?.strategies)
    .map(cleanText)
    .filter(Boolean)
    .join(", ") || cleanText(firstAttempt.selected?.strategy || selected.strategy || "not needed");
  const originalFailedDraft = cleanText(session.originalCandidate || "");
  const finalSelectedRewrite = cleanText(session.finalCandidate || selected.text || "");
  const beforeScore = Number(
    findCandidateScoreByText(room.candidates || [], session.originalCandidate) ||
      firstAttempt.selected?.writingScore ||
      0
  );
  const afterScore = Number(
    session.finalWritingExam?.total ||
      selected.writingExam?.total ||
      0
  );
  const blockingReasons = asList([
    room.status === "passed" ? [] : room.managingEditorReason,
    selected.writingExam?.blockingReasons,
    failedTeacherNamesFromChecks(selected.teacherChecks || []).map((name) => `${name} needs review.`),
  ]).flat().map(cleanText).filter(Boolean);
  const lessons = asList(room.rewriteLessonsUsed)
    .map((record) => cleanText(record.lesson || record))
    .filter(Boolean);

  return {
    originalWriterStatus: cleanText(room.status || "not_checked"),
    rewriteStatus: cleanText(session.status || (attempts.length ? "needs_review" : "not_needed")),
    originalFailedDraft,
    failedTeacherNames,
    copyRiskBefore: session.copyRiskBefore || selected.copyRisk || {},
    copyRiskAfter: session.copyRiskAfter || selected.copyRisk || {},
    rewriteDiagnosis: asList(firstAttempt.diagnosis?.reasons).map(cleanText).filter(Boolean),
    rewriteStrategyUsed,
    rewriteAttemptsCount: attempts.length,
    finalSelectedRewrite,
    beforeScore,
    afterScore,
    rewriteImprovementSummary: cleanText(session.improvementSummary || "No rewrite was needed or no rewrite passed yet."),
    blockingReasons,
    needsMoreContextMessage: session.status === "needs_more_context"
      ? cleanText(session.improvementSummary || room.managingEditorReason || "More source-backed context is needed.")
      : "",
    approvedRewriteLessons: lessons,
  };
}

function renderRewriteVisibilityPanel(writingPackage = {}) {
  const rooms = writingPackage.writerRoom?.fields || {};
  const entries = Object.entries(rooms);
  if (!entries.length) {
    return `
      <details class="rewrite-visibility-panel">
        <summary>Rewrite visibility</summary>
        <p class="writing-muted">No WriterRoom rewrite details are available for this draft yet.</p>
      </details>
    `;
  }
  return `
    <details class="rewrite-visibility-panel" open>
      <summary>Rewrite visibility</summary>
      <div class="rewrite-grid">
        ${entries.map(([fieldName, room]) => {
          const rewrite = summarizeRewriteStatus(room);
          return `
            <article class="rewrite-card ${rewrite.rewriteStatus}">
              <div class="candidate-top">
                <strong>${escapeHtml(fieldName)}</strong>
                <span>${escapeHtml(rewrite.rewriteStatus.replace(/_/g, " "))}</span>
              </div>
              <dl class="rewrite-details">
                <dt>Original writer status</dt>
                <dd>${escapeHtml(rewrite.originalWriterStatus.replace(/_/g, " "))}</dd>
                <dt>Rewrite status</dt>
                <dd>${escapeHtml(rewrite.rewriteStatus.replace(/_/g, " "))}</dd>
                <dt>Original failed draft</dt>
                <dd>${escapeHtml(rewrite.originalFailedDraft || "No failed draft recorded.")}</dd>
                <dt>Failed teacher names</dt>
                <dd>${escapeHtml(rewrite.failedTeacherNames.join(", ") || "None")}</dd>
                <dt>Copy-risk explanation</dt>
                <dd>Before: ${escapeHtml(copyRiskLabel(rewrite.copyRiskBefore))} · ${escapeHtml(copyRiskExplanation(rewrite.copyRiskBefore))}<br />After: ${escapeHtml(copyRiskLabel(rewrite.copyRiskAfter))} · ${escapeHtml(copyRiskExplanation(rewrite.copyRiskAfter))}</dd>
                <dt>Rewrite diagnosis</dt>
                <dd>${escapeHtml(rewrite.rewriteDiagnosis.join(" ") || "No rewrite diagnosis recorded.")}</dd>
                <dt>Rewrite strategy used</dt>
                <dd>${escapeHtml(rewrite.rewriteStrategyUsed)}</dd>
                <dt>Rewrite attempts count</dt>
                <dd>${escapeHtml(rewrite.rewriteAttemptsCount)}</dd>
                <dt>Final selected rewrite</dt>
                <dd>${escapeHtml(rewrite.finalSelectedRewrite || "No passing rewrite selected.")}</dd>
                <dt>Before score</dt>
                <dd>${escapeHtml(scoreLabel(rewrite.beforeScore))}/100</dd>
                <dt>After score</dt>
                <dd>${escapeHtml(scoreLabel(rewrite.afterScore))}/100</dd>
                <dt>Rewrite improvement summary</dt>
                <dd>${escapeHtml(rewrite.rewriteImprovementSummary)}</dd>
                <dt>Remaining blocking reasons</dt>
                <dd>${rewrite.blockingReasons.length ? renderList(rewrite.blockingReasons, "No remaining blockers.") : `<p class="writing-muted">No remaining blockers.</p>`}</dd>
                <dt>Needs more context</dt>
                <dd>${escapeHtml(rewrite.needsMoreContextMessage || "No needs-more-context message.")}</dd>
                <dt>Approved rewrite lesson</dt>
                <dd>${rewrite.approvedRewriteLessons.length ? renderList(rewrite.approvedRewriteLessons, "No approved rewrite lesson saved.") : `<p class="writing-muted">No approved rewrite lesson saved for this field yet.</p>`}</dd>
              </dl>
            </article>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function getTeacherRows(writingPackage) {
  const checks = asList(writingPackage.teacherChecks);
  if (checks.length) return checks;
  return Object.entries(writingPackage.fieldGates || {}).flatMap(([fieldName, gate]) =>
    asList(gate.teachers).map((teacher) => ({ ...teacher, fieldName }))
  );
}

function renderTeacherScores(writingPackage) {
  const rows = getTeacherRows(writingPackage).slice(0, 32);
  if (!rows.length) return `<p class="writing-muted">No teacher checks available yet.</p>`;
  return `
    <div class="teacher-score-grid">
      ${rows.map((teacher) => `
        <div class="teacher-score ${teacher.blocking ? "blocking" : teacher.passed ? "passed" : "warn"}">
          <strong>${escapeHtml(teacher.fieldName || "field")} · ${escapeHtml(teacher.name || "Teacher")}</strong>
          <span>${escapeHtml(scoreLabel(teacher.score))}/100 · ${teacher.passed ? "passed" : teacher.blocking ? "blocked" : "review"}</span>
          <small>${escapeHtml(teacher.reason || "No reason provided.")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCandidateDescriptions(writingPackage, draft) {
  const publisherText = cleanText(draft.originalPublisherTitle || draft.sourceSummary || "");
  const candidates = asList(writingPackage.descriptionCandidates);
  if (!candidates.length) return `<p class="writing-muted">No description candidates available yet.</p>`;
  const selectedText = cleanText(writingPackage.description);
  return `
    <div class="candidate-list">
      ${candidates.map((candidate) => {
        const text = cleanText(candidate.text);
        const fallback = detectFallbackRisk(text);
        const copy = publisherText ? detectCopyRisk(text, publisherText) : { risk: false, reason: "No publisher text available." };
        const selected = selectedText && text === selectedText;
        const passed = candidate.evaluation?.passed === true;
        const total = candidate.evaluation?.exam?.total;
        const blockingReasons = candidate.evaluation?.exam?.blockingReasons || [];
        return `
          <div class="candidate-card ${selected ? "selected" : ""} ${passed ? "passed" : "warn"}">
            <div class="candidate-top">
              <strong>${escapeHtml(candidate.label || candidate.id || "Candidate")}</strong>
              <span>${selected ? "Selected" : passed ? "Passed" : "Review"}</span>
            </div>
            <p>${escapeHtml(text || "No candidate text.")}</p>
            <small>Teacher score: ${escapeHtml(scoreLabel(total))}/100</small>
            ${fallback.risky ? `<small class="warning">Fallback risk: ${escapeHtml(fallback.matches?.join(", ") || "generic fallback pattern")}</small>` : ""}
            ${copy.risk ? `<small class="warning">Copy risk: ${escapeHtml(copy.reason)}</small>` : ""}
            ${blockingReasons.length ? `<div class="candidate-warnings">${renderList(blockingReasons, "No blocking warnings.")}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderEditorFields(writingPackage, draft) {
  return `
    <div class="editor-writing-fields">
      ${EDITABLE_FIELDS.map((field) => {
        const value = getPackageFieldValue(writingPackage, draft, field.fieldName);
        if (field.multiline) {
          return `
            <label>
              ${escapeHtml(field.label)}
              <textarea name="${escapeHtml(field.bodyName)}" rows="3">${escapeHtml(value)}</textarea>
            </label>
          `;
        }
        return `
          <label>
            ${escapeHtml(field.label)}
            <input name="${escapeHtml(field.bodyName)}" value="${escapeHtml(value)}" />
          </label>
        `;
      }).join("")}
      <label>
        Editor reason for manual writing changes
        <textarea name="editorReason" rows="2" placeholder="Example: Rewrote the description to name the confirmed event and remove vague filler."></textarea>
      </label>
      <p class="writing-muted">If you change approved wording and approve the story, Live News stores a safe writing lesson without comments, usernames, profiles, or secrets.</p>
    </div>
  `;
}

function renderStoryWritingQualityPanel(draft, validation = {}, options = {}) {
  const writingPackage = getWritingPackage(draft, validation);
  const context = writingPackage.context || {};
  const exam = writingPackage.writingExam || {};
  const status = cleanText(writingPackage.writingQualityStatus || "needs_review");
  const selectedDescription = cleanText(writingPackage.description || draft.description || draft.dek);
  const currentTitle = getPackageFieldValue(writingPackage, draft, "title");
  const currentDescription = getPackageFieldValue(writingPackage, draft, "description");
  const currentSummary = getPackageFieldValue(writingPackage, draft, "summary");
  const currentWhy = getPackageFieldValue(writingPackage, draft, "whyItMatters");
  const fieldScores = exam.fields || {};
  const fallback = detectFallbackRisk(currentDescription);
  const copy = detectCopyRisk(currentDescription, draft.originalPublisherTitle || draft.sourceSummary || "");

  return `
    <section class="writing-quality-panel" data-writing-quality-panel>
      <div class="writing-quality-head">
        <div>
          <p class="writing-eyebrow">Writing quality</p>
          <h3>Writing review before approval</h3>
        </div>
        <div class="writing-score ${status}">
          <strong>${escapeHtml(scoreLabel(exam.total))}</strong>
          <span>${escapeHtml(status.replace(/_/g, " "))}</span>
        </div>
      </div>

      <div class="writing-current-grid">
        <div><strong>Current generated title</strong><p>${escapeHtml(currentTitle || "Missing title.")}</p></div>
        <div><strong>Current generated description</strong><p>${escapeHtml(currentDescription || "Missing description.")}</p></div>
        <div><strong>Current generated summary</strong><p>${escapeHtml(currentSummary || "Missing summary.")}</p></div>
        <div><strong>Current why it matters</strong><p>${escapeHtml(currentWhy || "Missing why-it-matters text.")}</p></div>
      </div>

      <div class="writing-context">
        <strong>ArticleWritingContext summary</strong>
        <p>${escapeHtml(context.mainEvent || "Main event missing.")}</p>
        <div class="writing-context-tags">
          <span>Story ID: ${escapeHtml(context.storyId || draft.storyId || "missing")}</span>
          <span>Source: ${escapeHtml(context.sourceName || draft.primarySourceName || "missing")}</span>
          <span>Exact URL: ${escapeHtml(context.exactArticleUrl || draft.canonicalLiveNewsUrl || "missing")}</span>
          <span>Public safety: ${context.publicSafetyRelevant ? "conditional yes" : "no"}</span>
        </div>
      </div>

      <details open>
        <summary>Candidate descriptions and selected description</summary>
        <div class="selected-description"><strong>Selected description</strong><p>${escapeHtml(selectedDescription || "No selected description.")}</p></div>
        ${renderCandidateDescriptions(writingPackage, draft)}
      </details>

      <details>
        <summary>Teacher scores</summary>
        <div class="field-score-grid">
          ${Object.entries(fieldScores).map(([fieldName, field]) => `
            <span>${escapeHtml(fieldName)}: ${escapeHtml(scoreLabel(field.total))}/100 · ${field.passed ? "passed" : "review"}</span>
          `).join("") || "<span>No field scores available.</span>"}
        </div>
        ${renderTeacherScores(writingPackage)}
      </details>

      ${renderRewriteVisibilityPanel(writingPackage)}

      <details ${asList(writingPackage.blockingReasons).length || asList(writingPackage.missingContext).length ? "open" : ""}>
        <summary>Blocking warnings and missing context</summary>
        <div class="warning-columns">
          <div><strong>Blocking reasons</strong>${renderList(writingPackage.blockingReasons || validation.failures, "No blocking reasons.")}</div>
          <div><strong>Missing context</strong>${renderList(writingPackage.missingContext, "No missing context.")}</div>
          <div><strong>Fallback and copy risk</strong>
            ${fallback.risky ? `<p class="warning">Fallback risk found in selected description.</p>` : `<p class="writing-muted">No fallback risk in selected description.</p>`}
            ${copy.risk ? `<p class="warning">Copy risk: ${escapeHtml(copy.reason)}</p>` : `<p class="writing-muted">No strong copy risk in selected description.</p>`}
          </div>
        </div>
      </details>

      ${options.editable ? renderEditorFields(writingPackage, draft) : ""}
    </section>
  `;
}

function getBodyValue(body, key) {
  return cleanText(body?.[key]);
}

function buildDraftWithEditorWritingEdits(draft, body = {}) {
  const editedDraft = {
    ...draft,
    summary: Array.isArray(draft.summary) ? [...draft.summary] : asList(draft.summary),
  };
  const edits = [];
  const editorReason = getBodyValue(body, "editorReason");

  for (const field of EDITABLE_FIELDS) {
    const approvedOutput = getBodyValue(body, field.bodyName);
    const weakOutput = getDraftFieldValue(draft, field.fieldName);
    if (!approvedOutput || approvedOutput === weakOutput) continue;

    if (field.fieldName === "title") {
      editedDraft.headline = approvedOutput;
      editedDraft.title = approvedOutput;
    } else if (field.fieldName === "description") {
      editedDraft.description = approvedOutput;
      editedDraft.dek = approvedOutput;
    } else if (field.fieldName === "summary") {
      editedDraft.summary = [approvedOutput];
    } else if (field.fieldName === "whyItMatters") {
      editedDraft.whyItMatters = approvedOutput;
    }

    edits.push({
      fieldName: field.fieldName,
      weakOutput,
      approvedOutput,
      editorReason: editorReason || "Editor approved a stronger Live News wording.",
      sourceSafetyNotes: ["Saved from the private Story Approval dashboard."],
      publisherText: draft.originalPublisherTitle,
    });
  }

  return {
    draft: editedDraft,
    writingEdits: edits,
    editorReason,
  };
}

module.exports = {
  buildDraftWithEditorWritingEdits,
  renderStoryWritingQualityPanel,
};
