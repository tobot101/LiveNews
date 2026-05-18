import { db, doc, getDoc } from "./firebase-client.js";

const ALLOWED_MEMBERSHIP_STATUSES = new Set(["active", "trialing", "admin_granted"]);
const BLOCKED_MEMBERSHIP_STATUSES = new Set(["free", "expired", "past_due", "canceled"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isMembershipAllowed(membership = null) {
  return ALLOWED_MEMBERSHIP_STATUSES.has(normalizeStatus(membership?.status));
}

function getMembershipBlockReason(membershipResult = {}) {
  if (membershipResult.errorCode === "missing-membership") {
    return "No membership record was found for this account.";
  }
  if (membershipResult.errorCode === "permission-denied") {
    return "Live News could not read your membership record. Please check account permissions or try again.";
  }
  const status = normalizeStatus(membershipResult.data?.status);
  if (BLOCKED_MEMBERSHIP_STATUSES.has(status)) {
    return `This page requires an active membership. Your current status is ${status}.`;
  }
  return "This page requires an active membership.";
}

async function loadMembership(uid) {
  if (!uid) {
    return {
      exists: false,
      data: null,
      errorCode: "missing-user",
      message: "Log in to check membership access.",
    };
  }
  try {
    const snapshot = await getDoc(doc(db, "memberships", uid));
    if (!snapshot.exists()) {
      return {
        exists: false,
        data: null,
        errorCode: "missing-membership",
        message: "Missing membership document.",
      };
    }
    return {
      exists: true,
      data: snapshot.data(),
      errorCode: "",
      message: "",
    };
  } catch (error) {
    return {
      exists: false,
      data: null,
      errorCode: error?.code || "membership-read-failed",
      message: error?.message || "Unable to load membership.",
    };
  }
}

async function getMembershipAccess(user) {
  if (!user) {
    return {
      allowed: false,
      membership: null,
      reason: "Log in to view this membership page.",
      result: { errorCode: "missing-user" },
    };
  }
  const result = await loadMembership(user.uid);
  return {
    allowed: isMembershipAllowed(result.data),
    membership: result.data,
    reason: isMembershipAllowed(result.data) ? "" : getMembershipBlockReason(result),
    result,
  };
}

export {
  ALLOWED_MEMBERSHIP_STATUSES,
  BLOCKED_MEMBERSHIP_STATUSES,
  getMembershipAccess,
  getMembershipBlockReason,
  isMembershipAllowed,
  loadMembership,
};
