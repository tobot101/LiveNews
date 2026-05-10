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

function teacherScore(variant) {
  const checks = Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [];
  if (!checks.length) return "0/0 teacher checks";
  const passed = checks.filter((check) => check.passed === true).length;
  return `${passed}/${checks.length} teacher checks`;
}

function blockingWarnings(variant, platform) {
  const warnings = [];
  const checks = Array.isArray(variant.teacherChecks) ? variant.teacherChecks : [];
  for (const check of checks) {
    if (check && check.passed === false) warnings.push(`${cleanText(check.id || "teacher_check")} needs attention`);
  }
  if (variant.publishable !== true) warnings.push("Variant is not publishable yet.");
  if (!cleanText(variant.exactArticleUrl)) warnings.push("Exact article URL is missing.");
  if (platform === "instagram" && variant.imagePlan?.renderStatus !== "ready") {
    const missing = Array.isArray(variant.imagePlan?.missing) ? variant.imagePlan.missing.join(", ") : "";
    warnings.push(`Instagram image or generated card is not ready${missing ? `: ${missing}` : ""}.`);
  }
  return warnings;
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
    const warnings = blockingWarnings(variant, platform);
    const caption = variantCaptionText(variant, platform);
    const description = variantDescriptionText(variant, platform);
    const hashtags = variantHashtags(variant);
    const cta = exactArticleUrl ? `Read the Live News page: ${exactArticleUrl}` : "Blocked until exact Live News story URL exists.";
    const warningList = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
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
          <dd>${escapeHtml(exactArticleUrl || "Missing exact /stories/... URL")}</dd>
          <dt>CTA</dt>
          <dd>${escapeHtml(cta)}</dd>
          <dt>Teacher scores</dt>
          <dd>${escapeHtml(teacherScore(variant))}</dd>
          <dt>Publish state</dt>
          <dd>${variant.publishable === true ? "Publishable after editor selection and API checks" : "Not publishable"}</dd>
          ${platform === "instagram" ? `<dt>Render status</dt><dd>${escapeHtml(variant.renderStatus || variant.imagePlan?.renderStatus || "unknown")}</dd>` : ""}
        </dl>
        <div class="variant-warnings">
          <strong>Blocking warnings</strong>
          <ul>${warningList || "<li>No variant-level blocking warnings.</li>"}</ul>
        </div>
        <form method="post" action="${escapeHtml(actionUrl)}">
          <input type="hidden" name="socialDraftId" value="${escapeHtml(draft?.socialDraftId || "")}" />
          <input type="hidden" name="platform" value="${escapeHtml(platform)}" />
          <input type="hidden" name="variantId" value="${escapeHtml(variant.id || "")}" />
          <button type="submit" ${!exactArticleUrl ? "disabled" : ""}>${isSelected ? `Keep selected ${escapeHtml(platformLabel)} variant` : `Select this ${escapeHtml(platformLabel)} variant`}</button>
        </form>
      </article>
    `;
  }).join("");

  return `
    <section class="variant-review ${escapeHtml(platform)}" data-platform="${escapeHtml(platform)}">
      <div class="variant-review-header">
        <h3>${escapeHtml(platformLabel)} A/B caption review</h3>
        <span>${variants.length} variants • ${selectedId ? "1 selected" : "none selected"}</span>
      </div>
      <div class="variant-grid">${cards || empty}</div>
    </section>
  `;
}

module.exports = {
  blockingWarnings,
  renderSocialVariantReviewHtml,
  teacherScore,
  variantCaptionText,
};
