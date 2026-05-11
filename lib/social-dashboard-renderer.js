const { cleanText } = require("./article-agents/text-utils");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function variantCaptionText(variant, platform) {
  return platform === "facebook"
    ? cleanText(variant.message || variant.text || variant.caption || "")
    : cleanText(variant.caption || variant.text || variant.message || "");
}

function variantTitleText(variant, platform) {
  return platform === "facebook"
    ? cleanText(variant.title || variant.label || variant.id)
    : cleanText(variant.cardTitle || variant.shortTitle || variant.label || variant.id);
}

function variantDescriptionText(variant, platform) {
  return platform === "facebook"
    ? cleanText(variant.description || "")
    : cleanText(variant.cardSubtitle || variant.storyText || "");
}

function variantHashtags(variant) {
  return Array.isArray(variant.hashtags)
    ? variant.hashtags.map(cleanText).filter(Boolean).join(" ")
    : "";
}

function qualityStatus(variant) {
  const checks = Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [];
  if (!checks.length) return "Needs review";
  const passed = checks.filter((check) => check.passed === true).length;
  return passed === checks.length ? "Passed" : "Needs attention";
}

function writingQualityScore(variant) {
  const total = Number(variant?.writingExam?.total);
  if (Number.isFinite(total)) return `${Math.round(total)}/100`;
  const gate = (variant?.teacherChecks || []).find((check) => check.id === "writing_quality_gate");
  return Number.isFinite(Number(gate?.score)) ? `${Math.round(Number(gate.score))}/100` : "Not scored";
}

function socialReadinessScore(variant) {
  const checks = (Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [])
    .filter((check) => check && !String(check.id || "").startsWith("writing_"));
  if (!checks.length) return "No social checks";
  const passed = checks.filter((check) => check.passed === true).length;
  return `${passed}/${checks.length} checks passed`;
}

function failedSocialReadiness(variant) {
  return (Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [])
    .filter((check) => check && !String(check.id || "").startsWith("writing_") && check.passed === false);
}

function failedWritingReadiness(variant) {
  return (Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [])
    .filter((check) => check && String(check.id || "").startsWith("writing_") && check.passed === false);
}

function friendlyCheckLabel(check = {}) {
  const labels = {
    exact_story_link: "Exact story link",
    source_attribution: "Source attribution",
    internal_language: "Public wording",
    public_safety_conditional: "Conditional safety framing",
    instagram_media_ready: "Instagram image/card",
    writing_quality_gate: "Writing quality",
    writing_story_focus_teacher: "Story focus",
    writing_context_faithfulness_teacher: "Fact faithfulness",
    writing_human_clarity_teacher: "Human clarity",
    writing_description_specificity_teacher: "Description specificity",
    writing_rhythm_cadence_teacher: "Rhythm and cadence",
    writing_copy_risk_teacher: "Copy risk",
    writing_fallback_dependency_teacher: "Fallback dependency",
  };
  return cleanText(labels[check.id] || check.name || check.id || "Readiness check");
}

function friendlyCheckMessage(check = {}) {
  const messages = {
    exact_story_link: "Create the Live News article page before posting.",
    source_attribution: "Source attribution is missing.",
    internal_language: "Caption needs cleaner public wording.",
    public_safety_conditional: "Public safety language needs explicit source support.",
    instagram_media_ready: "Instagram image or generated card is not ready.",
  };
  return cleanText(messages[check.id] || check.message || check.reason || "Needs editor review.");
}

function renderFailedChecks(checks) {
  if (!checks.length) return "<li>None.</li>";
  return checks
    .map((check) => {
      const score = Number.isFinite(Number(check.score)) ? ` • ${Math.round(Number(check.score))}/100` : "";
      const message = friendlyCheckMessage(check);
      return `<li><strong>${escapeHtml(friendlyCheckLabel(check))}${escapeHtml(score)}</strong>${message ? `: ${escapeHtml(message)}` : ""}</li>`;
    })
    .join("");
}

function readinessNotes(variant, platform) {
  const warnings = [];
  const checks = Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [];
  const friendlyMessages = {
    exact_story_link: "Create the Live News article page before posting.",
    source_attribution: "Source attribution is missing.",
    internal_language: "Caption needs cleaner public wording.",
    public_safety_conditional: "Public safety language needs explicit source support.",
    instagram_media_ready: "Instagram image or generated card is not ready.",
    writing_quality_gate: "Writing quality needs editor review before posting.",
    writing_story_focus_teacher: "Caption needs a clearer connection to the actual story.",
    writing_context_faithfulness_teacher: "Caption may include unsupported wording.",
    writing_copy_risk_teacher: "Caption is too close to publisher wording.",
    writing_fallback_dependency_teacher: "Caption depends on fallback or template language.",
  };
  for (const check of checks) {
    if (check && check.passed === false) {
      warnings.push(cleanText(friendlyMessages[check.id] || check.message || "Readiness check needs attention"));
    }
  }
  if (variant.publishable !== true) warnings.push("Posting is locked until this draft passes readiness checks.");
  if (!cleanText(variant.exactArticleUrl)) warnings.push("Create the Live News article page before posting.");
  if (platform === "instagram" && variant.imagePlan?.renderStatus !== "ready") {
    const missing = Array.isArray(variant.imagePlan?.missing) ? variant.imagePlan.missing.join(", ") : "";
    warnings.push(`Instagram image or generated card is not ready${missing ? `: ${missing}` : ""}.`);
  }
  return [...new Set(warnings)];
}

function renderSocialVariantReviewHtml({ draft, platform, actionUrl = "/admin/social/select-variant" }) {
  const platformData = draft?.platforms?.[platform] || {};
  const variants = Array.isArray(platformData.variants) ? platformData.variants : [];
  const selectedId = cleanText(platformData.selectedVariantId);
  const exactArticleUrl = cleanText(draft?.linkState?.exactArticleUrl || "");
  const platformLabel = platform === "facebook" ? "Facebook" : "Instagram";
  const empty = `<article class="variant-card blocked"><h4>No ${escapeHtml(platformLabel)} variants available.</h4></article>`;
  const cards = variants.map((variant) => {
    const isSelected = selectedId && selectedId === cleanText(variant.id);
    const warnings = readinessNotes(variant, platform);
    const variantExactArticleUrl = cleanText(variant.exactArticleUrl || exactArticleUrl || "");
    const caption = variantCaptionText(variant, platform);
    const description = variantDescriptionText(variant, platform);
    const hashtags = variantHashtags(variant);
    const cta = variantExactArticleUrl
      ? `Read the Live News page: ${variantExactArticleUrl}`
      : "Posting locked until the exact Live News story URL exists.";
    const warningList = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
    const socialFailures = failedSocialReadiness(variant);
    const writingFailures = failedWritingReadiness(variant);
    return `
      <article class="variant-card ${isSelected ? "selected" : ""}" data-platform="${escapeHtml(platform)}" data-variant-id="${escapeHtml(variant.id)}">
        <div class="variant-card-top">
          <span class="variant-name">${escapeHtml(variant.label || variant.id)}</span>
          <span class="variant-state ${isSelected ? "selected" : "not-selected"}">${isSelected ? "Selected" : "Not selected"}</span>
        </div>
        <h4>${escapeHtml(variantTitleText(variant, platform))}</h4>
        <dl class="variant-details">
          <dt>Caption/message</dt>
          <dd><pre>${escapeHtml(caption)}</pre></dd>
          ${description ? `<dt>Description</dt><dd>${escapeHtml(description)}</dd>` : ""}
          <dt>Hashtags</dt>
          <dd>${escapeHtml(hashtags || "No hashtags")}</dd>
          <dt>Source attribution</dt>
          <dd>${escapeHtml(variant.sourceAttribution || draft?.sourceAttribution || "Original source")}</dd>
          <dt>Exact article URL</dt>
          <dd>${escapeHtml(variantExactArticleUrl || "Live News story URL pending")}</dd>
	          <dt>CTA</dt>
	          <dd>${escapeHtml(cta)}</dd>
	          <dt>Quality status</dt>
	          <dd>${escapeHtml(qualityStatus(variant))}</dd>
	          <dt>Writing quality score</dt>
	          <dd>${escapeHtml(writingQualityScore(variant))} • ${escapeHtml(variant.writingQualityStatus || "needs review")}</dd>
	          <dt>Social readiness score</dt>
	          <dd>${escapeHtml(socialReadinessScore(variant))}</dd>
	          <dt>Post state</dt>
	          <dd>${variant.publishable === true ? "Ready after editor selection and Meta checks" : "Not ready yet"}</dd>
	          ${platform === "instagram" ? `<dt>Render status</dt><dd>${escapeHtml(variant.renderStatus || variant.imagePlan?.renderStatus || "unknown")}</dd>` : ""}
	        </dl>
	        <div class="variant-warnings">
	          <strong>Readiness notes</strong>
	          <ul>${warningList || "<li>Ready for editor selection.</li>"}</ul>
	        </div>
	        <div class="variant-score-panel">
	          <strong>Writing warnings</strong>
	          <ul>${renderFailedChecks(writingFailures)}</ul>
	          <strong>Social readiness warnings</strong>
	          <ul>${renderFailedChecks(socialFailures)}</ul>
	        </div>
        <form method="post" action="${escapeHtml(actionUrl)}">
          <input type="hidden" name="socialDraftId" value="${escapeHtml(draft?.socialDraftId || "")}" />
          <input type="hidden" name="platform" value="${escapeHtml(platform)}" />
          <input type="hidden" name="variantId" value="${escapeHtml(variant.id || "")}" />
	          <button type="submit">${isSelected ? `Keep selected ${escapeHtml(platformLabel)} variant` : `Select this ${escapeHtml(platformLabel)} variant`}</button>
	        </form>
      </article>
    `;
  }).join("");

  return `
	    <section class="variant-review ${escapeHtml(platform)}" data-platform="${escapeHtml(platform)}">
	      <div class="variant-review-header">
	        <h3>${escapeHtml(platformLabel)} caption options</h3>
	        <span>${variants.length} variants • ${selectedId ? "1 selected" : "none selected"}</span>
	      </div>
      <div class="variant-grid">${cards || empty}</div>
    </section>
  `;
}

module.exports = {
  blockingWarnings: readinessNotes,
  readinessNotes,
  renderSocialVariantReviewHtml,
  teacherScore: qualityStatus,
  qualityStatus,
  variantCaptionText,
};
