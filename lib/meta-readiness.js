const { cleanText } = require("./article-agents/text-utils");

const META_READINESS_SCHEMA_VERSION = "live-news-meta-readiness-v1";
const META_REQUIRED_ENV = [
  {
    key: "META_APP_ID",
    label: "Meta App ID",
    secret: false,
    purpose: "Identifies the Live News Social Publisher app.",
  },
  {
    key: "META_PAGE_ID",
    label: "Facebook Page ID",
    secret: false,
    purpose: "Connects publishing to the Live News Facebook Page.",
  },
  {
    key: "META_INSTAGRAM_BUSINESS_ACCOUNT_ID",
    label: "Instagram business account ID",
    secret: false,
    purpose: "Connects publishing to the Live News Instagram professional account.",
  },
  {
    key: "META_PAGE_ACCESS_TOKEN",
    label: "Long-lived Page access token",
    secret: true,
    purpose: "Allows approved API testing after permissions are granted. Stored only in private environment variables.",
  },
  {
    key: "META_APP_REVIEW_APPROVED",
    label: "Meta App Review approved",
    secret: false,
    purpose: "Confirms publishing permissions have been approved by Meta.",
  },
];

const META_REQUIRED_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "pages_manage_posts",
  "instagram_content_publish",
];

const PLATFORM_REQUIRED_ENV = {
  facebook: [
    "META_APP_ID",
    "META_PAGE_ID",
    "META_PAGE_ACCESS_TOKEN",
    "META_APP_REVIEW_APPROVED",
  ],
  instagram: [
    "META_APP_ID",
    "META_INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "META_PAGE_ACCESS_TOKEN",
    "META_APP_REVIEW_APPROVED",
  ],
};

function hasValue(env, key) {
  return cleanText(env[key]).length > 0;
}

function boolEnv(env, key) {
  return /^(1|true|yes|approved)$/i.test(cleanText(env[key]));
}

function buildMetaReadiness(env = process.env) {
  const envChecks = META_REQUIRED_ENV.map((item) => {
    const present = item.key === "META_APP_REVIEW_APPROVED" ? boolEnv(env, item.key) : hasValue(env, item.key);
    return {
      key: item.key,
      label: item.label,
      secret: item.secret,
      present,
      valuePreview: item.secret ? (present ? "configured privately" : "missing") : present ? "configured" : "missing",
      purpose: item.purpose,
    };
  });
  const missing = envChecks.filter((item) => !item.present).map((item) => item.key);
  const postingExplicitlyEnabled = boolEnv(env, "LIVE_NEWS_META_POSTING_ENABLED");
  const checkByKey = Object.fromEntries(envChecks.map((item) => [item.key, item]));
  const platforms = Object.fromEntries(
    Object.entries(PLATFORM_REQUIRED_ENV).map(([platform, requiredKeys]) => {
      const platformMissing = requiredKeys.filter((key) => !checkByKey[key]?.present);
      const ready = platformMissing.length === 0;
      return [
        platform,
        {
          readyForApiTesting: ready,
          postingEnabled: postingExplicitlyEnabled && ready,
          missing: platformMissing,
          status: ready
            ? postingExplicitlyEnabled
              ? "ready_for_manual_api_testing"
              : "ready_but_api_posting_switch_off"
            : "configuration_missing",
        },
      ];
    })
  );
  const readyForApiTesting = Object.values(platforms).some((platform) => platform.readyForApiTesting);
  const autoPostAllowed = false;
  return {
    schemaVersion: META_READINESS_SCHEMA_VERSION,
    mode: "private_meta_connection_readiness",
    readyForApiTesting,
    postingEnabled: Object.values(platforms).some((platform) => platform.postingEnabled),
    autoPostAllowed,
    publicVisible: false,
    status: readyForApiTesting
      ? platforms.facebook.postingEnabled && platforms.instagram.postingEnabled
        ? "ready_for_manual_api_testing"
        : postingExplicitlyEnabled
          ? "partially_ready_for_manual_api_testing"
          : "ready_but_api_posting_switch_off"
      : "configuration_missing",
    missing,
    platforms,
    requiredPermissions: META_REQUIRED_PERMISSIONS,
    envChecks,
    safeguards: [
      "Never expose access tokens in HTML, JSON, logs, commits, or screenshots.",
      "Keep automatic posting disabled until human approval, Meta permissions, and manual testing are proven.",
      "Only post exact approved Live News story URLs, never homepage-only links.",
      "Use performance memory after posting; do not learn from private messages, usernames, comments text, cookies, or personal data.",
    ],
  };
}

module.exports = {
  META_READINESS_SCHEMA_VERSION,
  META_REQUIRED_ENV,
  META_REQUIRED_PERMISSIONS,
  buildMetaReadiness,
};
