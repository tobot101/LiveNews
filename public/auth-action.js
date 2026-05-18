import {
  applyActionCode,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  auth,
} from "./firebase-client.js";

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = byId(id);
  if (element) element.textContent = text;
}

function show(id, visible = true) {
  const element = byId(id);
  if (element) element.hidden = !visible;
}

function setStatus(text, tone = "") {
  const element = byId("authActionStatus");
  if (!element) return;
  element.textContent = text || "";
  element.className = `account-message${tone ? ` ${tone}` : ""}`;
}

function updateBrandShift() {
  const brand = document.querySelector(".brand");
  const topbar = document.querySelector(".topbar");
  if (!brand || !topbar) return;
  const tools = topbar.querySelector(".topbar-tools");
  const brandRect = brand.getBoundingClientRect();
  const toolsRect = tools ? tools.getBoundingClientRect() : null;
  let maxShift = 0;
  const toolsShareRow =
    toolsRect && Math.abs(toolsRect.top - brandRect.top) < Math.max(brandRect.height, 40);
  if (toolsRect && toolsShareRow) {
    maxShift = Math.max(0, Math.floor(toolsRect.left - brandRect.right - 20));
  }
  brand.style.setProperty("--brand-shift", `${maxShift}px`);
}

function showSuccess() {
  setText("authActionTitle", "Your email is verified.");
  setText("authActionMessage", "Your Live News account email has been confirmed.");
  setStatus("Email verification complete.", "success");
  show("authActionContinue", true);
  show("authActionResend", false);
  show("authActionLogin", false);
}

function showInvalidLink() {
  setText("authActionTitle", "This verification link is expired or invalid.");
  setText("authActionMessage", "You can request a fresh verification email from the signed-in account.");
  setStatus("The Firebase verification link could not be applied.", "warning");
  show("authActionContinue", false);
  show("authActionResend", true);
  show("authActionLogin", true);
}

async function handleResend() {
  const user = auth.currentUser;
  if (!user) {
    setStatus("Log in first, then send a new verification email.", "warning");
    show("authActionLogin", true);
    return;
  }
  try {
    await sendEmailVerification(user);
    setStatus("New verification email sent. Check your inbox.", "success");
  } catch (error) {
    setStatus(error?.message || "Unable to send a new verification email.", "error");
  }
}

async function handleActionCode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "";
  const oobCode = params.get("oobCode") || "";
  const continueUrl = params.get("continueUrl") || "";
  const lang = params.get("lang") || "";
  window.liveNewsAuthActionParams = { mode, oobCode, continueUrl, lang };

  byId("authActionResend")?.addEventListener("click", handleResend);
  updateBrandShift();

  if (mode !== "verifyEmail" || !oobCode) {
    showInvalidLink();
    return;
  }

  try {
    await applyActionCode(auth, oobCode);
    const user = auth.currentUser;
    if (user) {
      await reload(user);
    }
    showSuccess();
  } catch {
    showInvalidLink();
  }
}

updateBrandShift();
window.addEventListener("resize", updateBrandShift);
onAuthStateChanged(auth, () => {
  handleActionCode();
});
