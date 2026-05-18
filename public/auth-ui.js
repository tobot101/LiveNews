import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
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

async function sendVerificationForCurrentUser(messageId = "authMessage") {
  const user = auth.currentUser;
  if (!user) {
    setMessage(messageId, "Log in first so Live News can send a verification email.", "warning");
    return;
  }
  await sendEmailVerification(user);
  setMessage(messageId, "Verification email sent. Check your inbox, then come back and confirm verification.", "success");
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
    const confirmPassword = String(byId("signupPasswordConfirm")?.value || "");
    if (password !== confirmPassword) {
      setMessage("authMessage", "Passwords do not match. Please type the same password twice.", "error");
      return;
    }
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await createAccountDocuments(credential.user);
      await sendVerificationForCurrentUser("authMessage");
      const panel = byId("emailVerificationPanel");
      if (panel) panel.hidden = false;
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

function bindPasswordReset() {
  const toggle = byId("forgotPasswordToggle");
  const panel = byId("forgotPasswordPanel");
  const form = byId("passwordResetForm");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      const resetEmail = byId("resetEmail");
      const loginEmail = String(byId("loginEmail")?.value || "").trim();
      if (resetEmail && loginEmail && !resetEmail.value) resetEmail.value = loginEmail;
    });
  }
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(byId("resetEmail")?.value || byId("loginEmail")?.value || "").trim();
    if (!email) {
      setMessage("resetMessage", "Enter your email so Live News can send the reset link.", "warning");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("resetMessage", "Password reset email sent. Check your inbox.", "success");
    } catch (error) {
      setMessage("resetMessage", friendlyAuthError(error), "error");
    }
  });
}

function bindVerificationControls() {
  const resendButtons = document.querySelectorAll("[data-resend-verification]");
  resendButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await sendVerificationForCurrentUser(button.getAttribute("data-message-target") || "authMessage");
      } catch (error) {
        setMessage(button.getAttribute("data-message-target") || "authMessage", friendlyAuthError(error), "error");
      }
    });
  });
  document.querySelectorAll("[data-check-email-verification]").forEach((button) => {
    button.addEventListener("click", async () => {
      const messageId = button.getAttribute("data-message-target") || "authMessage";
      const currentUser = auth.currentUser;
      if (!currentUser) {
        window.location.href = "/login";
        return;
      }
      try {
        await reload(currentUser);
        if (currentUser.emailVerified) {
          window.location.href = "/account?verified=1";
          return;
        }
        setMessage(messageId, "Your email is not verified yet. Open the verification email and click the verification link first.", "warning");
      } catch (error) {
        setMessage(messageId, friendlyAuthError(error), "error");
      }
    });
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
  setText("accountEmailVerified", user?.emailVerified ? "Verified" : "Not verified");
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
  const verifiedBanner = byId("accountVerifiedBanner");
  if (verifiedBanner) {
    const params = new URLSearchParams(window.location.search);
    verifiedBanner.hidden = params.get("verified") !== "1";
  }
  if (!user) {
    setMessage("accountMessage", "Log in to view your Live News account.", "warning");
    return;
  }
  try {
    await reload(user);
  } catch {
    // Account rendering should still work if Auth reload is temporarily unavailable.
  }
  const verificationPanel = byId("accountVerificationPanel");
  if (verificationPanel) verificationPanel.hidden = Boolean(user.emailVerified);
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
bindPasswordReset();
bindLogoutButtons();
bindVerificationControls();

onAuthStateChanged(auth, async (user) => {
  updateAuthLinks(user);
  await initAccountPage(user);
  await initProtectedPage(user);
});
