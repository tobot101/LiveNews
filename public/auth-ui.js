import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  auth,
  db,
  doc,
  serverTimestamp,
  setDoc,
} from "./firebase-client.js";
import { getMembershipAccess, loadMembership } from "./membership-access.js";

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = byId(id);
  if (element) element.textContent = text;
}

function setMessage(id, text, tone = "") {
  const element = byId(id);
  if (!element) return;
  element.textContent = text || "";
  element.className = `account-message${tone ? ` ${tone}` : ""}`;
}

function friendlyAuthError(error) {
  const code = String(error?.code || "");
  if (code === "auth/email-already-in-use") return "That email already has a Live News account.";
  if (code === "auth/weak-password") return "Use a stronger password with at least 6 characters.";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "The email or password did not match.";
  if (code === "auth/user-not-found") return "No Live News account was found for that email.";
  if (code === "permission-denied" || code === "firestore/permission-denied") return "Firebase permissions blocked this request.";
  return error?.message || "Something went wrong. Please try again.";
}

async function createAccountDocuments(user) {
  const timestamp = serverTimestamp();
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: "user",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await setDoc(doc(db, "memberships", user.uid), {
    uid: user.uid,
    status: "free",
    plan: "free",
    accessLevel: 0,
    source: "auth_created",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function bindSignupForm() {
  const form = byId("signupForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("authMessage", "Creating your account...");
    const email = String(byId("signupEmail")?.value || "").trim();
    const password = String(byId("signupPassword")?.value || "");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await createAccountDocuments(credential.user);
      setMessage("authMessage", "Account created. You are starting on the free plan.", "success");
      window.setTimeout(() => {
        window.location.href = "/account";
      }, 600);
    } catch (error) {
      setMessage("authMessage", friendlyAuthError(error), "error");
    }
  });
}

function bindLoginForm() {
  const form = byId("loginForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("authMessage", "Signing in...");
    const email = String(byId("loginEmail")?.value || "").trim();
    const password = String(byId("loginPassword")?.value || "");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setMessage("authMessage", "Signed in.", "success");
      window.setTimeout(() => {
        window.location.href = "/account";
      }, 400);
    } catch (error) {
      setMessage("authMessage", friendlyAuthError(error), "error");
    }
  });
}

function bindLogoutButtons() {
  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "/login";
    });
  });
}

function renderAccount(user, membershipResult) {
  setText("accountEmail", user?.email || "Not signed in");
  const membership = membershipResult?.data || null;
  setText("membershipStatus", membership?.status || "missing membership document");
  setText("membershipPlan", membership?.plan || "none");
  setText("membershipAccessLevel", String(membership?.accessLevel ?? 0));
  if (!membershipResult?.exists) {
    setMessage("accountMessage", membershipResult?.message || "Membership record is missing.", "warning");
  } else {
    setMessage("accountMessage", "Membership loaded.", "success");
  }
}

async function initAccountPage(user) {
  if (!byId("accountPanel")) return;
  if (!user) {
    setMessage("accountMessage", "Log in to view your Live News account.", "warning");
    return;
  }
  const membershipResult = await loadMembership(user.uid);
  renderAccount(user, membershipResult);
}

async function initProtectedPage(user) {
  const gate = byId("protectedGate");
  if (!gate) return;
  const allowedPanel = byId("protectedAllowed");
  const blockedPanel = byId("protectedBlocked");
  const access = await getMembershipAccess(user);
  if (allowedPanel) allowedPanel.hidden = !access.allowed;
  if (blockedPanel) blockedPanel.hidden = access.allowed;
  if (access.allowed) {
    setMessage("protectedMessage", "Access granted.", "success");
    return;
  }
  setText("protectedReason", access.reason);
  setMessage("protectedMessage", "Membership required.", "warning");
}

function updateAuthLinks(user) {
  document.querySelectorAll("[data-auth-email]").forEach((element) => {
    element.textContent = user?.email || "Signed out";
  });
  document.querySelectorAll("[data-signed-in]").forEach((element) => {
    element.hidden = !user;
  });
  document.querySelectorAll("[data-signed-out]").forEach((element) => {
    element.hidden = Boolean(user);
  });
}

bindSignupForm();
bindLoginForm();
bindLogoutButtons();

onAuthStateChanged(auth, async (user) => {
  updateAuthLinks(user);
  await initAccountPage(user);
  await initProtectedPage(user);
});
