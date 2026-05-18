const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = JSON.parse(read("package.json"));
const firebaseClient = read("public/firebase-client.js");
const membershipAccess = read("public/membership-access.js");
const authUi = read("public/auth-ui.js");
const authActionHtml = read("public/auth-action.html");
const authActionJs = read("public/auth-action.js");
const signupHtml = read("public/signup.html");
const loginHtml = read("public/login.html");
const accountHtml = read("public/account.html");
const protectedHtml = read("public/protected-test.html");
const serverJs = read("server.js");
const indexHtml = read("public/index.html");

expect(Boolean(packageJson.dependencies?.firebase), "Firebase should be installed as a dependency.");
expect(firebaseClient.includes("initializeApp") && firebaseClient.includes("getAuth") && firebaseClient.includes("getFirestore"), "Firebase client should initialize app, auth, and Firestore.");
expect(firebaseClient.includes("isAnalyticsSupported()"), "Firebase Analytics should only initialize after browser support is checked.");
expect(firebaseClient.includes("live-news-membership"), "Firebase client should use the Live News membership Firebase project config.");

expect(authUi.includes("createUserWithEmailAndPassword"), "Signup should use Firebase email/password auth.");
expect(authUi.includes("signInWithEmailAndPassword"), "Login should use Firebase email/password auth.");
expect(authUi.includes("signOut"), "Logout should use Firebase auth signOut.");
expect(authUi.includes("sendEmailVerification"), "Signup should send a Firebase email verification email.");
expect(authUi.includes("sendPasswordResetEmail"), "Login should support Firebase password reset email.");
expect(authUi.includes("password !== confirmPassword"), "Signup should require matching password confirmation.");
expect(authUi.includes("await user.reload()"), "Verify-email button should reload the current Firebase user before checking emailVerified.");
expect(authUi.includes("Your email is not verified yet. Open the verification email and click the verification link first."), "Verify-email button should show the required not-yet-verified message.");
expect(authUi.includes('doc(db, "users", user.uid)') && authUi.includes('doc(db, "memberships", user.uid)'), "Signup should create user and membership documents by uid.");
expect(authUi.includes('role: "user"'), "New user document should start with role user.");
expect(authUi.includes("emailVerified: Boolean(user.emailVerified)"), "User records should track Firebase email verification state.");
expect(authUi.includes('status: "free"') && authUi.includes('plan: "free"') && authUi.includes("accessLevel: 0"), "New membership should start as free with access level 0.");
expect(authUi.includes("stripeCustomerId: null") && authUi.includes("stripeSubscriptionId: null"), "Membership record should reserve Stripe fields without adding payment logic.");

expect(membershipAccess.includes('"active"') && membershipAccess.includes('"trialing"') && membershipAccess.includes('"admin_granted"'), "Membership checker should allow active, trialing, and admin_granted.");
expect(membershipAccess.includes('"free"') && membershipAccess.includes('"expired"') && membershipAccess.includes('"past_due"') && membershipAccess.includes('"canceled"'), "Membership checker should block free, expired, past_due, and canceled.");
expect(membershipAccess.includes('doc(db, "memberships", uid)'), "Membership checker should load memberships/{uid}.");
expect(membershipAccess.includes("missing-membership"), "Membership checker should handle a missing membership document.");

expect(signupHtml.includes('id="signupForm"') && signupHtml.includes('type="email"') && signupHtml.includes('type="password"'), "Signup page should include an email/password form.");
expect(signupHtml.includes('id="signupPasswordConfirm"'), "Signup page should include a confirm password field.");
expect(signupHtml.includes("I verified my email") && signupHtml.includes("Resend verification email"), "Signup page should include email verification actions.");
expect(loginHtml.includes('id="loginForm"') && loginHtml.includes('type="email"') && loginHtml.includes('type="password"'), "Login page should include an email/password form.");
expect(loginHtml.includes("Forgot password?") && loginHtml.includes('id="passwordResetForm"'), "Login page should include a forgot-password reset email form.");
expect(accountHtml.includes("membershipStatus") && accountHtml.includes("membershipPlan") && accountHtml.includes("membershipAccessLevel"), "Account page should show membership status, plan, and access level.");
expect(accountHtml.includes("accountEmailVerified") && accountHtml.includes("accountVerificationPanel"), "Account page should show email verification status and verification actions.");
expect(authActionHtml.includes("authActionTitle") && authActionHtml.includes("Continue to Live News") && authActionHtml.includes("Send a new verification email"), "Custom auth action page should include success and resend UI.");
expect(authActionJs.includes("new URLSearchParams(window.location.search)") && authActionJs.includes('params.get("mode")') && authActionJs.includes('params.get("oobCode")'), "Custom auth action handler should read mode and oobCode URL parameters.");
expect(authActionJs.includes('params.get("continueUrl")') && authActionJs.includes('params.get("lang")'), "Custom auth action handler should read continueUrl and lang URL parameters.");
expect(authActionJs.includes('mode !== "verifyEmail"') && authActionJs.includes("applyActionCode(auth, oobCode)"), "Custom auth action handler should apply verifyEmail action codes.");
expect(authActionJs.includes("Your email is verified.") && authActionJs.includes("This verification link is expired or invalid."), "Custom auth action handler should show required success and invalid-link messages.");
expect(authActionJs.includes("sendEmailVerification(user)"), "Invalid verification page should support sending a new verification email.");
expect(protectedHtml.includes("Allowed statuses: active, trialing, or admin_granted") && protectedHtml.includes("protectedBlocked"), "Protected test page should display allowed statuses and a blocked state.");

expect(serverJs.includes('app.get("/signup"') && serverJs.includes('app.get("/login"') && serverJs.includes('app.get("/account"') && serverJs.includes('app.get("/auth/action"') && serverJs.includes('app.get("/protected-test"'), "Server should expose clean membership routes.");
expect(indexHtml.includes('href="/login"') && indexHtml.includes('href="/account"'), "Homepage should expose simple login and account links.");

expect(!authUi.includes("checkout") && !authUi.includes("createCheckout") && !authUi.includes("Stripe("), "Phase 1 should not add checkout or Stripe logic.");
expect(!authUi.includes('status: "active"') && !authUi.includes('status: "trialing"') && !authUi.includes('status: "admin_granted"'), "Frontend should not grant paid/admin membership statuses.");

if (failures.length) {
  console.error("Live News membership foundation check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News membership foundation check passed.");
console.log("Routes checked: /signup, /login, /account, /protected-test");
