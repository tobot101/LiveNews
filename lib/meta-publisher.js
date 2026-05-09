const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const { cleanText, stableHash } = require("./article-agents/text-utils");
const { buildMetaReadiness } = require("./meta-readiness");

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

function getDraftCaption(draft, platform) {
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
  return cleanText(overrideUrl || draft?.platforms?.instagram?.mediaCard?.imageUrl || "");
}

function assertDraftCanPublish(draft, platform, options = {}, env = process.env) {
  const failures = [];
  const warnings = [];
  const config = getMetaConfig(env);
  const exactArticleUrl = getDraftExactUrl(draft, options.exactArticleUrl);

  if (!draft || !cleanText(draft.socialDraftId)) failures.push("Social draft was not found.");
  if (!config.readiness.postingEnabled) {
    failures.push("Meta API posting is locked until Railway variables, App Review, and the posting switch are ready.");
  }
  if (config.readiness.autoPostAllowed !== false) failures.push("Meta auto-posting must stay disabled.");
  if (!exactArticleUrl) failures.push("An exact Live News /stories/... article URL is required before posting.");
  if (draft?.autoPostAllowed !== false) failures.push("Only human-reviewed social drafts can be posted.");
  if (draft?.publishStatus !== "private_review_only") failures.push("Draft must remain private review-only before manual API posting.");
  if (draft?.supervisor?.shareableNow === false) warnings.push("Draft supervisor has not marked this story as shareable yet.");

  if (platform === "facebook" && !config.pageId) failures.push("Facebook Page ID is missing.");
  if (platform === "instagram") {
    const imageUrl = getInstagramImageUrl(draft, options.imageUrl);
    if (!config.instagramBusinessAccountId) failures.push("Instagram business account ID is missing.");
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
    failures: validation.failures,
    warnings: validation.warnings,
  };
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
    captionVariantId: cleanText(draft?.platforms?.[platform]?.primaryVariantId),
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
  const result = await postForm(
    plan.endpoint,
    {
      message: getDraftCaption(draft, "facebook"),
      link: plan.exactArticleUrl,
      published: "true",
    },
    config.pageAccessToken,
    options.fetchImpl
  );
  const record = buildPostRecord({
    draft,
    platform: "facebook",
    exactArticleUrl: plan.exactArticleUrl,
    metaPostId: result.id,
    warnings: plan.warnings,
  });
  const store = options.skipStore ? readMetaPostStore() : saveMetaPostRecord(record);
  return { posted: true, platform: "facebook", plan, result: { id: result.id }, record, store };
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
  const container = await postForm(
    plan.mediaContainerEndpoint,
    {
      image_url: plan.imageUrl,
      caption: getDraftCaption(draft, "instagram"),
    },
    config.pageAccessToken,
    options.fetchImpl
  );
  const published = await postForm(
    plan.mediaPublishEndpoint,
    {
      creation_id: container.id,
    },
    config.pageAccessToken,
    options.fetchImpl
  );
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
};
