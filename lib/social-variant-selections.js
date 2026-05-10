const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const { cleanText, stableHash } = require("./article-agents/text-utils");

const SOCIAL_VARIANT_SELECTIONS_SCHEMA_VERSION = "live-news-social-variant-selections-v1";
const PLATFORMS = new Set(["facebook", "instagram"]);

const DEFAULT_SOCIAL_VARIANT_SELECTION_STORE = {
  schemaVersion: SOCIAL_VARIANT_SELECTIONS_SCHEMA_VERSION,
  mode: "private_editor_variant_selection",
  autoPostAllowed: false,
  publicVisible: false,
  updatedAt: null,
  selections: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlatform(value) {
  return cleanText(value).toLowerCase();
}

function normalizeExactArticleUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    if (!/\/stories\/[^/]+/i.test(parsed.pathname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function getPlatformVariants(draft, platform) {
  return Array.isArray(draft?.platforms?.[platform]?.variants)
    ? draft.platforms[platform].variants
    : [];
}

function getVariantText(variant, platform) {
  if (platform === "facebook") return cleanText(variant?.message || variant?.text || variant?.caption || "");
  return cleanText(variant?.caption || variant?.text || variant?.message || "");
}

function findSocialVariant(draft, platform, variantId) {
  const target = cleanText(variantId);
  if (!target) return null;
  return getPlatformVariants(draft, platform).find((variant) => cleanText(variant.id) === target) || null;
}

function selectionKey(socialDraftId, platform) {
  return `${cleanText(socialDraftId)}:${normalizePlatform(platform)}`;
}

function validateSocialVariantSelection(draft, platformValue, variantId) {
  const failures = [];
  const warnings = [];
  const platform = normalizePlatform(platformValue);
  const socialDraftId = cleanText(draft?.socialDraftId);

  if (!PLATFORMS.has(platform)) failures.push("Platform must be facebook or instagram.");
  if (!socialDraftId) failures.push("Social draft is missing.");

  const variant = PLATFORMS.has(platform) ? findSocialVariant(draft, platform, variantId) : null;
  if (!variant) failures.push("Selected variant was not found on the current draft.");

  const exactArticleUrl = normalizeExactArticleUrl(variant?.exactArticleUrl || draft?.linkState?.exactArticleUrl);
  if (!exactArticleUrl) failures.push("Selected variant must point to an exact /stories/... Live News article URL.");

  if (!getVariantText(variant, platform)) failures.push("Selected variant is missing public caption text.");

  const failedTeacherChecks = (variant?.teacherChecks || []).filter((check) => check && check.passed === false);
  if (failedTeacherChecks.length) {
    warnings.push(`Selected variant has ${failedTeacherChecks.length} teacher warning(s) to review before posting.`);
  }

  if (variant?.publishable === false) {
    warnings.push("Selected variant is currently marked not publishable; API posting may remain blocked.");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    normalized: {
      platform,
      socialDraftId,
      variantId: cleanText(variantId),
      exactArticleUrl,
    },
    variant,
  };
}

function buildVariantSnapshot(draft, platform, variant, exactArticleUrl) {
  const base = {
    id: cleanText(variant?.id),
    label: cleanText(variant?.label || variant?.shape || variant?.id),
    exactArticleUrl,
    sourceAttribution: cleanText(variant?.sourceAttribution || draft?.sourceAttribution),
    hashtags: Array.isArray(variant?.hashtags) ? variant.hashtags.map(cleanText).filter(Boolean) : [],
    captionShape: cleanText(variant?.captionShape || variant?.shape),
    safetyFlags: variant?.safetyFlags || {},
    teacherChecks: Array.isArray(variant?.teacherChecks) ? variant.teacherChecks : [],
    publishable: variant?.publishable === true,
  };
  if (platform === "facebook") {
    return {
      ...base,
      title: cleanText(variant?.title || draft?.title),
      message: getVariantText(variant, platform),
      description: cleanText(variant?.description || draft?.summary),
    };
  }
  return {
    ...base,
    shortTitle: cleanText(variant?.shortTitle || draft?.title),
    caption: getVariantText(variant, platform),
    cardTitle: cleanText(variant?.cardTitle || variant?.shortTitle || draft?.title),
    cardSubtitle: cleanText(variant?.cardSubtitle || draft?.summary),
    altText: cleanText(variant?.altText),
    storyText: cleanText(variant?.storyText),
    carouselSlides: Array.isArray(variant?.carouselSlides) ? variant.carouselSlides : [],
    imagePlan: variant?.imagePlan || draft?.platforms?.instagram?.imagePlan || {},
  };
}

function createEmptySocialVariantSelectionStore() {
  return clone(DEFAULT_SOCIAL_VARIANT_SELECTION_STORE);
}

function readSocialVariantSelectionStore() {
  const store = readJson(STORE_PATHS.socialVariantSelections, DEFAULT_SOCIAL_VARIANT_SELECTION_STORE);
  return {
    ...clone(DEFAULT_SOCIAL_VARIANT_SELECTION_STORE),
    ...store,
    schemaVersion: SOCIAL_VARIANT_SELECTIONS_SCHEMA_VERSION,
    autoPostAllowed: false,
    publicVisible: false,
  };
}

function saveSocialVariantSelectionStore(store) {
  writeJson(STORE_PATHS.socialVariantSelections, {
    ...clone(DEFAULT_SOCIAL_VARIANT_SELECTION_STORE),
    ...store,
    schemaVersion: SOCIAL_VARIANT_SELECTIONS_SCHEMA_VERSION,
    updatedAt: nowIso(),
    autoPostAllowed: false,
    publicVisible: false,
  });
}

function recordSocialVariantSelectionInStore(store, draft, platformValue, variantId, options = {}) {
  const validation = validateSocialVariantSelection(draft, platformValue, variantId);
  if (!validation.ok) {
    const error = new Error(`Social variant selection is not safe to save: ${validation.failures.join(" ")}`);
    error.failures = validation.failures;
    throw error;
  }

  const selectedAt = options.selectedAt || nowIso();
  const key = selectionKey(validation.normalized.socialDraftId, validation.normalized.platform);
  const record = {
    schemaVersion: "live-news-social-variant-selection-v1",
    selectionId: `ln-social-selection-${stableHash(`${key}:${validation.normalized.variantId}`, 14)}`,
    selectionKey: key,
    socialDraftId: validation.normalized.socialDraftId,
    storyId: cleanText(draft?.storyId),
    platform: validation.normalized.platform,
    variantId: validation.normalized.variantId,
    selectedAt,
    selectedBy: cleanText(options.selectedBy || "Live News editor"),
    exactArticleUrl: validation.normalized.exactArticleUrl,
    sourceAttribution: cleanText(draft?.sourceAttribution),
    variant: buildVariantSnapshot(
      draft,
      validation.normalized.platform,
      validation.variant,
      validation.normalized.exactArticleUrl
    ),
    warnings: validation.warnings,
    autoPostAllowed: false,
    publicVisible: false,
  };

  const nextStore = {
    ...clone(DEFAULT_SOCIAL_VARIANT_SELECTION_STORE),
    ...store,
    updatedAt: selectedAt,
    selections: [
      record,
      ...(store.selections || []).filter((item) => item.selectionKey !== key),
    ].slice(0, 300),
  };

  return {
    store: nextStore,
    selection: record,
    warnings: validation.warnings,
  };
}

function recordSocialVariantSelection(draft, platform, variantId, options = {}) {
  const current = readSocialVariantSelectionStore();
  const result = recordSocialVariantSelectionInStore(current, draft, platform, variantId, options);
  saveSocialVariantSelectionStore(result.store);
  return result;
}

function getSelectionForDraft(store, draft, platformValue) {
  const platform = normalizePlatform(platformValue);
  const key = selectionKey(draft?.socialDraftId, platform);
  return (store?.selections || []).find((selection) => selection.selectionKey === key) || null;
}

function applySocialVariantSelectionsToDraft(draft, store = readSocialVariantSelectionStore()) {
  if (!draft) return draft;
  const next = {
    ...draft,
    platforms: {
      ...draft.platforms,
    },
  };

  for (const platform of PLATFORMS) {
    const platformData = draft.platforms?.[platform];
    if (!platformData) continue;
    const selection = getSelectionForDraft(store, draft, platform);
    const selectedVariant = selection ? findSocialVariant(draft, platform, selection.variantId) : null;
    const variants = getPlatformVariants(draft, platform).map((variant) => ({
      ...variant,
      selected: Boolean(selectedVariant && variant.id === selectedVariant.id),
    }));
    next.platforms[platform] = {
      ...platformData,
      variants,
      selectedVariantId: selectedVariant ? selectedVariant.id : "",
      selectedVariant: selectedVariant ? { ...selectedVariant, selected: true } : null,
      selectedAt: selectedVariant ? selection.selectedAt : "",
    };
    if (selectedVariant && platform === "facebook") {
      next.platforms[platform].caption = getVariantText(selectedVariant, platform);
      next.platforms[platform].link = selection.exactArticleUrl;
    }
    if (selectedVariant && platform === "instagram") {
      next.platforms[platform].caption = getVariantText(selectedVariant, platform);
    }
  }

  return next;
}

function applySocialVariantSelectionsToRun(run, store = readSocialVariantSelectionStore()) {
  return {
    ...run,
    drafts: (run.drafts || []).map((draft) => applySocialVariantSelectionsToDraft(draft, store)),
    variantSelectionMode: "editor_selected_before_posting",
  };
}

module.exports = {
  DEFAULT_SOCIAL_VARIANT_SELECTION_STORE,
  SOCIAL_VARIANT_SELECTIONS_SCHEMA_VERSION,
  applySocialVariantSelectionsToDraft,
  applySocialVariantSelectionsToRun,
  createEmptySocialVariantSelectionStore,
  findSocialVariant,
  getSelectionForDraft,
  getVariantText,
  readSocialVariantSelectionStore,
  recordSocialVariantSelection,
  recordSocialVariantSelectionInStore,
  saveSocialVariantSelectionStore,
  validateSocialVariantSelection,
};
