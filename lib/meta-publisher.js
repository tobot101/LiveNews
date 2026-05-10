const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const { cleanText, stableHash } = require("./article-agents/text-utils");
const { buildMetaReadiness } = require("./meta-readiness");
const { buildInstagramCardPlan } = require("./social-card-generator");

const META_POSTS_SCHEMA_VERSION = "live-news-meta-posts-v1";
const DEFAULT_GRAPH_VERSION = "v22.0";
const DEFAULT_META_POST_STORE = {
  schemaVersion: META_POSTS_SCHEMA_VERSION,
  mode: "private_manual_meta_publishing",
  autoPost: false,
  publicVisible: false,
  updatedAt: null,
  posts: [],
};

function getGraphVersion(env = process.env) {
  const version = cleanText(env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).replace(/^\/+/, "");
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

function getMetaConfig(env = process.env) {
  const readiness = buildMetaReadiness(env);
  return {
    readiness,
    graphVersion: getGraphVersion(env),
    pageId: cleanText(env.META_PAGE_ID),
    instagramBusinessAccountId: cleanText(env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID),
    pageAccessToken: cleanText(env.META_PAGE_ACCESS_TOKEN),
  };
}

function getStoryUrl(value) {
  const url = cleanText(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    if (!/\/stories\/[^/]+/i.test(parsed.pathname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isPublicHttpsUrl(value) {
  const url = cleanText(value);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function cleanCaption(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getSelectedPlatformVariant(draft, platform) {
  const selected = draft?.platforms?.[platform]?.selectedVariant;
  if (selected && cleanText(selected.id)) return selected;
  const selectedId = cleanText(draft?.platforms?.[platform]?.selectedVariantId);
  if (!selectedId) return null;
  return (draft?.platforms?.[platform]?.variants || [])
    .find((variant) => cleanText(variant.id) === selectedId) || null;
}

function getDraftCaption(draft, platform) {
  const selectedVariant = getSelectedPlatformVariant(draft, platform);
  const selectedCaption = platform === "facebook"
    ? cleanCaption(selectedVariant?.message || selectedVariant?.text || selectedVariant?.caption)
    : cleanCaption(selectedVariant?.caption || selectedVariant?.text || selectedVariant?.message);
  if (selectedCaption) return selectedCaption;
  const caption = cleanCaption(draft?.platforms?.[platform]?.caption);
  if (caption) return caption;
  const title = cleanText(draft?.title || "Live News story");
  const summary = cleanText(draft?.summary || "");
  const source = cleanText(draft?.sourceAttribution || "original source");
  return [title, summary, `Source-linked coverage from ${source}.`].filter(Boolean).join("\n\n");
}

function getDraftExactUrl(draft, overrideUrl = "") {
  return getStoryUrl(overrideUrl) || getStoryUrl(draft?.linkState?.exactArticleUrl);
}

function getInstagramImageUrl(draft, overrideUrl = "") {
  const plan = getInstagramImagePlan(draft, overrideUrl);
  return cleanText(plan.imageUrl || plan.generatedCardUrl || "");
}

function getInstagramImagePlan(draft, overrideUrl = "") {
  const selectedVariant = getSelectedPlatformVariant(draft, "instagram");
  const selectedPlan = selectedVariant?.imagePlan || {};
  const platformPlan = draft?.platforms?.instagram?.imagePlan || {};
  const mediaPlan = draft?.platforms?.instagram?.mediaCard?.imagePlan || {};
  return buildInstagramCardPlan({
    cardTitle:
      selectedVariant?.cardTitle ||
      platformPlan.cardTitle ||
      mediaPlan.cardTitle ||
      draft?.platforms?.instagram?.mediaCard?.title ||
      draft?.title,
    cardSubtitle:
      selectedVariant?.cardSubtitle ||
      platformPlan.cardSubtitle ||
      mediaPlan.cardSubtitle ||
      draft?.summary,
    sourceLabel:
      selectedVariant?.sourceAttribution ||
      platformPlan.sourceLabel ||
      mediaPlan.sourceLabel ||
      draft?.sourceAttribution,
    exactArticleUrl: getDraftExactUrl(draft),
    imageUrl:
      overrideUrl ||
      selectedPlan.imageUrl ||
      platformPlan.imageUrl ||
      mediaPlan.imageUrl ||
      draft?.platforms?.instagram?.mediaCard?.imageUrl,
    generatedCardUrl:
      selectedPlan.generatedCardUrl ||
      platformPlan.generatedCardUrl ||
      mediaPlan.generatedCardUrl ||
      draft?.platforms?.instagram?.mediaCard?.generatedCardUrl,
    altText: selectedVariant?.altText || platformPlan.altText || mediaPlan.altText,
  });
}

function assertDraftCanPublish(draft, platform, options = {}, env = process.env) {
  const failures = [];
  const warnings = [];
  const config = getMetaConfig(env);
  const exactArticleUrl = getDraftExactUrl(draft, options.exactArticleUrl);
  const platformReadiness = config.readiness.platforms?.[platform];
  const selectedVariant = getSelectedPlatformVariant(draft, platform);

  if (!draft || !cleanText(draft.socialDraftId)) failures.push("Social draft was not found.");
  if (!platformReadiness?.postingEnabled) {
    const platformLabel = platform === "instagram" ? "Instagram" : "Facebook";
    failures.push(`${platformLabel} API posting is locked until its Railway variables, App Review, and the posting switch are ready.`);
  }
  if (config.readiness.autoPostAllowed !== false) failures.push("Meta auto-posting must stay disabled.");
  if (!exactArticleUrl) failures.push("An exact Live News /stories/... article URL is required before posting.");
  if (!selectedVariant) failures.push(`Select a ${platform === "instagram" ? "Instagram" : "Facebook"} caption variant before API posting.`);
  if (selectedVariant?.exactArticleUrl && getStoryUrl(selectedVariant.exactArticleUrl) !== exactArticleUrl) {
    failures.push("Selected variant exact article URL does not match the draft's exact /stories/... URL.");
  }
  if (selectedVariant && selectedVariant.publishable !== true) failures.push("Selected variant is marked not publishable by teacher checks.");
  if (draft?.autoPostAllowed !== false) failures.push("Only human-reviewed social drafts can be posted.");
  if (draft?.publishStatus !== "private_review_only") failures.push("Draft must remain private review-only before manual API posting.");
  if (draft?.supervisor?.shareableNow === false) warnings.push("Draft supervisor has not marked this story as shareable yet.");

  if (platform === "facebook" && !config.pageId) failures.push("Facebook Page ID is missing.");
  if (platform === "instagram") {
    const imagePlan = getInstagramImagePlan(draft, options.imageUrl);
    const imageUrl = cleanText(imagePlan.imageUrl || imagePlan.generatedCardUrl);
    if (!config.instagramBusinessAccountId) failures.push("Instagram business account ID is missing.");
    if (imagePlan.renderStatus !== "ready") {
      failures.push(`Instagram visual readiness is blocked until ${cleanText((imagePlan.missing || []).join(", ")) || "a durable image/card URL"} is ready.`);
    }
    if (!imageUrl) failures.push("Instagram publishing needs a public image URL for the media container.");
    if (imageUrl && !isPublicHttpsUrl(imageUrl)) {
      failures.push("Instagram image URL must be a public HTTPS URL, not a local or private URL.");
    }
    if (imageUrl && !/\.(jpe?g|png|webp)(\?|#|$)/i.test(imageUrl)) {
      warnings.push("Instagram image URL should point directly to a durable image file when possible.");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    config,
    exactArticleUrl,
  };
}

function graphUrl(config, path) {
  return `https://graph.facebook.com/${config.graphVersion}/${String(path || "").replace(/^\/+/, "")}`;
}

function graphGetUrl(config, path, params = {}, token = "") {
  const url = new URL(graphUrl(config, path));
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}

function redactedPayload(payload) {
  const clone = {};
  for (const [key, value] of Object.entries(payload || {})) {
    clone[key] = key.toLowerCase().includes("token") ? "configured privately" : value;
  }
  return clone;
}

function buildFacebookPublishPlan(draft, options = {}, env = process.env) {
  const validation = assertDraftCanPublish(draft, "facebook", options, env);
  const caption = getDraftCaption(draft, "facebook");
  const payload = {
    message: caption,
    link: validation.exactArticleUrl,
    published: "true",
  };
  const endpoint = validation.config.pageId ? graphUrl(validation.config, `${validation.config.pageId}/feed`) : "";
  return {
    schemaVersion: "live-news-meta-facebook-plan-v1",
    platform: "facebook",
    ready: validation.ok,
    endpoint,
    payload: redactedPayload(payload),
    exactArticleUrl: validation.exactArticleUrl,
    failures: validation.failures,
    warnings: validation.warnings,
  };
}

function buildInstagramPublishPlan(draft, options = {}, env = process.env) {
  const validation = assertDraftCanPublish(draft, "instagram", options, env);
  const caption = getDraftCaption(draft, "instagram");
  const imageUrl = getInstagramImageUrl(draft, options.imageUrl);
  const imagePlan = getInstagramImagePlan(draft, options.imageUrl);
  const containerPayload = {
    image_url: imageUrl,
    caption,
  };
  const publishPayload = {
    creation_id: "returned_by_container_step",
  };
  const base = validation.config.instagramBusinessAccountId;
  return {
    schemaVersion: "live-news-meta-instagram-plan-v1",
    platform: "instagram",
    ready: validation.ok,
    mediaContainerEndpoint: base ? graphUrl(validation.config, `${base}/media`) : "",
    mediaPublishEndpoint: base ? graphUrl(validation.config, `${base}/media_publish`) : "",
    containerPayload: redactedPayload(containerPayload),
    publishPayload: redactedPayload(publishPayload),
    exactArticleUrl: validation.exactArticleUrl,
    imageUrl,
    imagePlan,
    renderStatus: imagePlan.renderStatus,
    failures: validation.failures,
    warnings: validation.warnings,
  };
}

function buildMetaSetupFailures(error, platform = "facebook") {
  const message = cleanText(error?.metaError?.message || error?.message || "");
  const code = cleanText(error?.metaError?.code || "");
  const lower = message.toLowerCase();
  const label = platform === "instagram" ? "Instagram" : "Facebook";
  const failures = [`${label} API publish was blocked by Meta; nothing was posted.`];

  if (
    code === "200" ||
    lower.includes("pages_manage_posts") ||
    lower.includes("pages_read_engagement") ||
    lower.includes("publish_to_groups")
  ) {
    failures.push("The saved token is not being accepted as a Live News Page publishing token.");
    failures.push("Generate a token for the Live News Page with pages_read_engagement and pages_manage_posts, then save it in Railway as META_PAGE_ACCESS_TOKEN.");
    failures.push("In Meta Business Settings, the app/system user must have Page content-creation access for the Live News Facebook Page.");
    return failures;
  }

  if (lower.includes("error validating access token") || lower.includes("session has expired")) {
    failures.push("The saved Meta token appears expired or invalid. Generate a fresh long-lived token and update Railway.");
    return failures;
  }

  if (lower.includes("unsupported post request") || lower.includes("object does not exist")) {
    failures.push("The token cannot see the configured Page or Instagram account. Confirm META_PAGE_ID and business asset access.");
    return failures;
  }

  if (lower.includes("permission") || lower.includes("permissions")) {
    failures.push("Meta says the token is missing a required permission or app-review feature.");
    return failures;
  }

  failures.push(message || "Meta returned an unknown publishing error.");
  return failures;
}

function enrichMetaPublishError(error, platform) {
  error.failures = error.failures || buildMetaSetupFailures(error, platform);
  return error;
}

function hasPageContentTask(tasks = []) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => cleanText(task).toUpperCase())
    .some((task) => ["CREATE_CONTENT", "MANAGE"].includes(task));
}

async function fetchJson(endpoint, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available for Meta API publishing.");
  const response = await fetchImpl(endpoint, { method: "GET" });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!response.ok || json.error) {
    const error = new Error(cleanText(json.error?.message || json.raw || `Meta request failed with ${response.status}`));
    error.metaStatus = response.status;
    error.metaError = json.error || json;
    throw error;
  }
  return json;
}

async function resolveFacebookPageAccessToken(config, fetchImpl = global.fetch) {
  const configuredToken = config.pageAccessToken;
  const diagnostics = {
    source: "configured_token_direct",
    pageMatched: false,
    pageName: "",
    tasks: [],
    warnings: [],
  };

  if (!configuredToken || !config.pageId) {
    return { accessToken: configuredToken, diagnostics };
  }

  try {
    const accounts = await fetchJson(
      graphGetUrl(
        config,
        "me/accounts",
        {
          fields: "name,id,access_token,tasks",
          limit: 100,
        },
        configuredToken
      ),
      fetchImpl
    );
    const page = (accounts.data || []).find((item) => cleanText(item.id) === cleanText(config.pageId));
    if (!page) {
      diagnostics.warnings.push("The configured token can list Pages, but it did not include the Live News Facebook Page.");
      return { accessToken: configuredToken, diagnostics };
    }
    diagnostics.source = page.access_token ? "derived_page_token_from_me_accounts" : "matched_page_without_returned_token";
    diagnostics.pageMatched = true;
    diagnostics.pageName = cleanText(page.name);
    diagnostics.tasks = Array.isArray(page.tasks) ? page.tasks.map(cleanText).filter(Boolean) : [];
    if (diagnostics.tasks.length && !hasPageContentTask(diagnostics.tasks)) {
      const error = new Error("The Live News Page is visible, but the token does not show Page content-creation access.");
      error.failures = [
        "Meta token can see the Live News Page, but Page tasks do not include content creation.",
        "In Meta Business Settings, give the app/system user or connected user CREATE_CONTENT or full control for the Live News Facebook Page.",
        "The post was not published.",
      ];
      error.plan = { tokenDiagnostics: diagnostics };
      throw error;
    }
    if (page.access_token) return { accessToken: cleanText(page.access_token), diagnostics };
    diagnostics.warnings.push("Meta matched the Page but did not return a Page token; using the configured token directly.");
  } catch (error) {
    if (error.failures) throw error;
    diagnostics.warnings.push("Could not derive a Page token from /me/accounts; using the configured token directly.");
  }

  return { accessToken: configuredToken, diagnostics };
}

async function postForm(endpoint, payload, token, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available for Meta API publishing.");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload || {})) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }
  body.set("access_token", token);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!response.ok || json.error) {
    const message = cleanText(json.error?.message || json.raw || `Meta request failed with ${response.status}`);
    const error = new Error(message);
    error.metaStatus = response.status;
    error.metaError = json.error || json;
    throw error;
  }
  return json;
}

function readMetaPostStore() {
  return readJson(STORE_PATHS.metaPosts, DEFAULT_META_POST_STORE);
}

function saveMetaPostRecord(record) {
  const store = readMetaPostStore();
  const posts = [record, ...(store.posts || [])].slice(0, 150);
  const updated = {
    ...DEFAULT_META_POST_STORE,
    ...store,
    updatedAt: new Date().toISOString(),
    posts,
  };
  writeJson(STORE_PATHS.metaPosts, updated);
  return updated;
}

function buildPostRecord({ draft, platform, exactArticleUrl, metaPostId, warnings = [], status = "posted" }) {
  const postedAt = new Date().toISOString();
  const recordKey = [
    platform,
    cleanText(draft?.socialDraftId),
    exactArticleUrl,
    metaPostId,
    postedAt,
  ].join(":");
  return {
    schemaVersion: "live-news-meta-post-record-v1",
    postRecordId: `ln-meta-post-${stableHash(recordKey, 14)}`,
    socialDraftId: cleanText(draft?.socialDraftId),
    storyId: cleanText(draft?.storyId),
    platform,
    status,
    exactArticleUrl,
    metaPostId: cleanText(metaPostId),
    captionVariantId: cleanText(
      draft?.platforms?.[platform]?.selectedVariantId ||
      draft?.platforms?.[platform]?.primaryVariantId
    ),
    placementLabel: cleanText(draft?.placementLabel),
    sourceAttribution: cleanText(draft?.sourceAttribution),
    postedAt,
    autoPost: false,
    publicVisibleOnLiveNews: false,
    warnings,
  };
}

async function publishFacebookDraft(draft, options = {}) {
  const env = options.env || process.env;
  const config = getMetaConfig(env);
  const plan = buildFacebookPublishPlan(draft, options, env);
  if (!plan.ready) {
    const error = new Error(plan.failures.join(" "));
    error.failures = plan.failures;
    error.plan = plan;
    throw error;
  }
  let tokenResolution;
  let result;
  try {
    tokenResolution = await resolveFacebookPageAccessToken(config, options.fetchImpl);
    result = await postForm(
      plan.endpoint,
      {
        message: getDraftCaption(draft, "facebook"),
        link: plan.exactArticleUrl,
        published: "true",
      },
      tokenResolution.accessToken,
      options.fetchImpl
    );
  } catch (error) {
    if (error.plan && !error.plan.endpoint) error.plan = { ...plan, ...error.plan };
    throw enrichMetaPublishError(error, "facebook");
  }
  const record = buildPostRecord({
    draft,
    platform: "facebook",
    exactArticleUrl: plan.exactArticleUrl,
    metaPostId: result.id,
    warnings: [...(plan.warnings || []), ...(tokenResolution?.diagnostics?.warnings || [])],
  });
  const store = options.skipStore ? readMetaPostStore() : saveMetaPostRecord(record);
  return {
    posted: true,
    platform: "facebook",
    plan: {
      ...plan,
      tokenDiagnostics: {
        ...tokenResolution.diagnostics,
        accessToken: "configured privately",
      },
    },
    result: { id: result.id },
    record,
    store,
  };
}

async function publishInstagramDraft(draft, options = {}) {
  const env = options.env || process.env;
  const config = getMetaConfig(env);
  const plan = buildInstagramPublishPlan(draft, options, env);
  if (!plan.ready) {
    const error = new Error(plan.failures.join(" "));
    error.failures = plan.failures;
    error.plan = plan;
    throw error;
  }
  let container;
  let published;
  try {
    // TODO: When generated cards are rendered by Live News, pass that durable public card URL into this media container step.
    container = await postForm(
      plan.mediaContainerEndpoint,
      {
        image_url: plan.imageUrl,
        caption: getDraftCaption(draft, "instagram"),
      },
      config.pageAccessToken,
      options.fetchImpl
    );
    // TODO: Keep this media_publish call behind manual editor approval and Meta readiness switches.
    published = await postForm(
      plan.mediaPublishEndpoint,
      {
        creation_id: container.id,
      },
      config.pageAccessToken,
      options.fetchImpl
    );
  } catch (error) {
    throw enrichMetaPublishError(error, "instagram");
  }
  const record = buildPostRecord({
    draft,
    platform: "instagram",
    exactArticleUrl: plan.exactArticleUrl,
    metaPostId: published.id,
    warnings: plan.warnings,
  });
  const store = options.skipStore ? readMetaPostStore() : saveMetaPostRecord(record);
  return {
    posted: true,
    platform: "instagram",
    plan,
    result: { containerId: container.id, id: published.id },
    record,
    store,
  };
}

module.exports = {
  META_POSTS_SCHEMA_VERSION,
  buildFacebookPublishPlan,
  buildInstagramPublishPlan,
  getMetaConfig,
  isPublicHttpsUrl,
  publishFacebookDraft,
  publishInstagramDraft,
  readMetaPostStore,
  resolveFacebookPageAccessToken,
};
