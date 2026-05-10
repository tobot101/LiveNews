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
      selectedVariantId: "facebook-selected",
      selectedVariant: {
        id: "facebook-selected",
        message: "Top Story of the Day: Live News test story.\n\nA concise source-linked summary built for testing.\n\nhttps://newsmorenow.com/stories/live-news-test-story-abc123",
        exactArticleUrl: "https://newsmorenow.com/stories/live-news-test-story-abc123",
        publishable: true,
      },
      caption: "Top Story of the Day: Live News test story.\n\nA concise source-linked summary built for testing.\n\nhttps://newsmorenow.com/stories/live-news-test-story-abc123",
    },
    instagram: {
      primaryVariantId: "instagram-primary",
      selectedVariantId: "instagram-selected",
      selectedVariant: {
        id: "instagram-selected",
        caption: "LIVE NEWS\nTop Story of the Day\n\nLive News test story.\n\nRead: https://newsmorenow.com/stories/live-news-test-story-abc123",
        exactArticleUrl: "https://newsmorenow.com/stories/live-news-test-story-abc123",
        publishable: true,
      },
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

const facebookOnlyPlan = buildFacebookPublishPlan(
  draft,
  {},
  {
    META_APP_ID: "123456",
    META_PAGE_ID: "987654",
    META_PAGE_ACCESS_TOKEN: "mock-private-page-token",
    META_APP_REVIEW_APPROVED: "true",
    LIVE_NEWS_META_POSTING_ENABLED: "true",
  }
);
if (!facebookOnlyPlan.ready) {
  failures.push("Facebook publish plan should not be blocked by a missing Instagram business account ID.");
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

const generatedCardDraft = {
  ...noImageDraft,
  platforms: {
    ...noImageDraft.platforms,
    instagram: {
      ...noImageDraft.platforms.instagram,
      imagePlan: {
        generatedCardUrl: "https://newsmorenow.com/social-cards/live-news-test-story.png",
      },
    },
  },
};
const instagramGeneratedCard = buildInstagramPublishPlan(generatedCardDraft, {}, env);
if (!instagramGeneratedCard.ready || instagramGeneratedCard.imageUrl !== "https://newsmorenow.com/social-cards/live-news-test-story.png") {
  failures.push("Instagram publish plan should accept a durable generated social-card URL.");
}

const calls = [];
async function mockFetch(endpoint, init) {
  calls.push({ endpoint, body: String(init.body || "") });
  if (String(endpoint).includes("/me/accounts")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [
            {
              id: env.META_PAGE_ID,
              name: "Live News",
              access_token: "derived-private-page-token",
              tasks: ["CREATE_CONTENT", "ANALYZE"],
            },
          ],
        });
      },
    };
  }
  return {
    ok: true,
    status: 200,
    async text() {
      const postCalls = calls.filter((call) => !String(call.endpoint).includes("/me/accounts"));
      return JSON.stringify({ id: postCalls.length === 1 ? "meta-first-id" : "meta-second-id" });
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

  if (!calls.some((call) => call.body.includes("access_token=derived-private-page-token"))) {
    failures.push("Facebook posting should derive and use the Page access token when Meta returns one for the configured Page.");
  }

  async function mockMissingContentTask(endpoint) {
    if (String(endpoint).includes("/me/accounts")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            data: [
              {
                id: env.META_PAGE_ID,
                name: "Live News",
                access_token: "derived-private-page-token",
                tasks: ["ANALYZE"],
              },
            ],
          });
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ id: "should-not-post" });
      },
    };
  }

  try {
    await publishFacebookDraft(draft, {
      env,
      fetchImpl: mockMissingContentTask,
      skipStore: true,
    });
    failures.push("Facebook publishing should stop before posting when Page content-creation access is missing.");
  } catch (error) {
    if (!String(error.failures || "").includes("content creation")) {
      failures.push("Missing Page content-creation access should produce a clear setup failure.");
    }
  }

  async function mockMetaPermissionError(endpoint) {
    if (String(endpoint).includes("/me/accounts")) {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({ error: { message: "Cannot derive page token here", code: 100 } });
        },
      };
    }
    return {
      ok: false,
      status: 403,
      async text() {
        return JSON.stringify({
          error: {
            message:
              "(#200) If posting to a page, requires both pages_read_engagement and pages_manage_posts permission with page token",
            code: 200,
          },
        });
      },
    };
  }

  try {
    await publishFacebookDraft(draft, {
      env,
      fetchImpl: mockMetaPermissionError,
      skipStore: true,
    });
    failures.push("Facebook publishing should surface Meta permission errors instead of pretending to post.");
  } catch (error) {
    const text = String(error.failures || "");
    if (!text.includes("META_PAGE_ACCESS_TOKEN") || !text.includes("nothing was posted")) {
      failures.push("Meta #200 permission errors should explain the Page token/Railway fix and confirm nothing posted.");
    }
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
