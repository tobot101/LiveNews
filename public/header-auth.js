import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth } from "./firebase-client.js";

function setHeaderAuthState(user) {
  const signedIn = Boolean(user);
  document.querySelectorAll("[data-header-auth='signed-in']").forEach((element) => {
    element.hidden = !signedIn;
  });
  document.querySelectorAll("[data-header-auth='signed-out']").forEach((element) => {
    element.hidden = signedIn;
  });
  document.documentElement.dataset.authState = signedIn ? "signed-in" : "signed-out";
  window.dispatchEvent(new Event("resize"));
}

document.querySelectorAll("[data-header-auth]").forEach((element) => {
  element.hidden = true;
});

onAuthStateChanged(auth, setHeaderAuthState, () => {
  setHeaderAuthState(null);
});
