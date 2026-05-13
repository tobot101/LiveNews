const { getLocalIntelligenceConfig } = require("./local-intelligence-config");

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label || "local-intelligence-task"} timed out after ${timeoutMs}ms`);
  error.code = "LOCAL_INTELLIGENCE_TIMEOUT";
  return error;
}

function withWorkerTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(promise);
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function runLocalWorkerBatch(tasks = [], worker, options = {}) {
  const config = options.config || getLocalIntelligenceConfig();
  const concurrency = Math.max(1, Number(options.concurrency || config.sourceFetchConcurrency || 1));
  const timeoutMs = Number(options.timeoutMs || config.sourceFetchTimeoutMs || 0);
  const workerName = options.workerName || "local-intelligence-worker";
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        const value = await withWorkerTimeout(worker(tasks[currentIndex], currentIndex), timeoutMs, workerName);
        results[currentIndex] = { status: "fulfilled", value };
      } catch (error) {
        results[currentIndex] = { status: "rejected", reason: error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, runOne);
  await Promise.all(workers);
  return results;
}

function createLocalIntelligenceWorker(options = {}) {
  const config = options.config || getLocalIntelligenceConfig();
  return {
    config,
    runBatch(tasks, worker, batchOptions = {}) {
      return runLocalWorkerBatch(tasks, worker, { ...batchOptions, config });
    },
  };
}

module.exports = {
  createLocalIntelligenceWorker,
  runLocalWorkerBatch,
  withWorkerTimeout,
};
