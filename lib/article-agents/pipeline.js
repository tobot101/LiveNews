const { buildStoryPackets } = require("./story-packets");
const { generateDraft } = require("./draft-agent");
const { evaluateDraft } = require("./evals");
const { readStyleMemory } = require("./store");
const { stableHash } = require("./text-utils");

const PIPELINE_VERSION = "live-news-agent-pipeline-v1";
const AGENT_SEQUENCE = [
  "Source Normalizer Agent",
  "Story Packet Agent",
  "Draft Writer Agent",
  "Style Variation Agent",
  "Source Auditor Agent",
  "Fact and Grounding Agent",
  "Human Review Gate",
];

function runArticleAgents(newsPayload, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const styleMemory = options.styleMemory || readStyleMemory();
  const packets = buildStoryPackets(newsPayload, {
    generatedAt,
    limit: options.limit || 16,
  });
  const drafts = packets.map((packet) => {
    const draft = generateDraft(packet, { generatedAt });
    const evaluation = evaluateDraft(packet, draft, styleMemory);
    return {
      ...draft,
      evaluation,
      agentTrace: {
        runId: "",
        storyId: packet.storyId,
        agents: AGENT_SEQUENCE,
        mode: "review_only",
        autoPublish: false,
      },
    };
  });
  const runId = `ln-agent-run-${stableHash(`${generatedAt}:${drafts.map((draft) => draft.storyId).join(",")}`, 14)}`;
  drafts.forEach((draft) => {
    draft.agentTrace.runId = runId;
    if (draft.styleFingerprint) {
      draft.styleFingerprint.storyId = draft.storyId;
    }
  });

  return {
    run: {
      schemaVersion: PIPELINE_VERSION,
      runId,
      generatedAt,
      mode: "review_only",
      autoPublish: false,
      articlePagesCreated: 0,
      agentSequence: AGENT_SEQUENCE,
      packetCount: packets.length,
      draftCount: drafts.length,
      passedQualityGates: drafts.filter((draft) => draft.evaluation?.passed).length,
      needsHumanReview: drafts.filter((draft) => draft.requiredHumanReview).length,
    },
    packets,
    drafts,
  };
}

module.exports = {
  AGENT_SEQUENCE,
  PIPELINE_VERSION,
  runArticleAgents,
};
