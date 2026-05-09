const {
  buildFacebookPublishPlan,
  buildInstagramPublishPlan,
  publishFacebookDraft,
  publishInstagramDraft,
} = require("../lib/meta-publisher");

const failures = [];

const env = {
  META_APP_ID: "123456",
  META_PAGE_ID: "987654",
  META_INSTAGRAM_BUSINESS_ACCOUNT_ID: "112233",
  META_PAGE_ACCESS_TOKEN: "mock-private-page-token",
  META_APP_REVIEW_APPROVED: "true",
  LIVE_NEWS_META_POSTING_ENABLED: "true",
};

const draft = {
  socialDraftId: "ln-social-test",
  storyId: "story-test",
  placementLabel: "Top Story of the Day",
  title: "Live News test story",
  summary: "A concise source-linked summary built for testing.",
  category: "National",
  sourceAttribution: "Test Source",
  autoPostAllowed: false,
  publishStatus: "private_review_only",
  linkState: {
    exactArticleUrl: "https://newsmorenow.com/stories/live-news-test-story-abc123",
  },
  supervisor: {
    shareableNow: true,
  },
  platforms: {
    facebook: {
      primaryVariantId: "facebook-primary",
      caption: "Top Story of the Day: Live News test story.\n\nA concise source-linked summary built for testing.\n\nhttps://newsmorenow.com/stories/live-news-test-story-abc123",
    },
    instagram: {
      primaryVariantId: "instagram-primary",
      caption: "LIVE NEWS\nTop Story of the Day\n\nLive News test story.\n\nRead: https://newsmorenow.com/stories/live-news-test-story-abc123",
      mediaCard: {
        imageUrl: "https://newsmorenow.com/android-chrome-512x512.png",
      },
    },
  },
};

const locked = buildFacebookPublishPlan(draft, {}, {});
if (locked.ready) {
  failures.push("Facebook publish plan should stay locked without Meta configuration.");
}

const facebookPlan = buildFacebookPublishPlan(draft, {}, env);
if (!facebookPlan.ready || !facebookPlan.endpoint.includes("/987654/feed")) {
  failures.push("Facebook publish plan should be ready with a Page feed endpoint when configured.");
}
if (facebookPlan.exactArticleUrl === "https://newsmorenow.com/") {
  failures.push("Facebook publish plan must never use the homepage as the post link.");
}
if (JSON.stringify(facebookPlan).includes(env.META_PAGE_ACCESS_TOKEN)) {
  failures.push("Facebook publish plan must not expose the private Page access token.");
}

const instagramPlan = buildInstagramPublishPlan(draft, {}, env);
if (!instagramPlan.ready || !instagramPlan.mediaContainerEndpoint.includes("/112233/media")) {
  failures.push("Instagram publish plan should be ready with a media container endpoint when configured.");
}
if (!instagramPlan.containerPayload.caption.includes(draft.linkState.exactArticleUrl)) {
  failures.push("Instagram caption should include the exact Live News article URL.");
}
if (JSON.stringify(instagramPlan).includes(env.META_PAGE_ACCESS_TOKEN)) {
  failures.push("Instagram publish plan must not expose the private Page access token.");
}

const noImageDraft = {
  ...draft,
  platforms: {
    ...draft.platforms,
    instagram: {
      ...draft.platforms.instagram,
      mediaCard: { imageUrl: "" },
    },
  },
};
const instagramNoImage = buildInstagramPublishPlan(noImageDraft, {}, env);
if (instagramNoImage.ready || !instagramNoImage.failures.some((failure) => failure.includes("public image URL"))) {
  failures.push("Instagram publish plan should block when no public image URL exists.");
}

const calls = [];
async function mockFetch(endpoint, init) {
  calls.push({ endpoint, body: String(init.body || "") });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ id: calls.length === 1 ? "meta-first-id" : "meta-second-id" });
    },
  };
}

async function runPublishChecks() {
  const facebook = await publishFacebookDraft(draft, {
    env,
    fetchImpl: mockFetch,
    skipStore: true,
  });
  if (!facebook.posted || facebook.result.id !== "meta-first-id") {
    failures.push("Facebook publish should return a redacted successful result from Meta.");
  }
  if (JSON.stringify(facebook).includes(env.META_PAGE_ACCESS_TOKEN)) {
    failures.push("Facebook publish result must not expose the private Page access token.");
  }

  const instagram = await publishInstagramDraft(draft, {
    env,
    fetchImpl: mockFetch,
    skipStore: true,
  });
  if (!instagram.posted || instagram.result.id !== "meta-second-id") {
    failures.push("Instagram publish should create a container and then publish it.");
  }
  if (JSON.stringify(instagram).includes(env.META_PAGE_ACCESS_TOKEN)) {
    failures.push("Instagram publish result must not expose the private Page access token.");
  }

  if (!calls.some((call) => call.body.includes("access_token=mock-private-page-token"))) {
    failures.push("Meta API requests should include the access token only inside the outbound private request body.");
  }

  if (failures.length) {
    console.error("Live News Meta publishing check failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("Live News Meta publishing check passed.");
  console.log(`Mock Meta calls: ${calls.length}`);
}

runPublishChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
