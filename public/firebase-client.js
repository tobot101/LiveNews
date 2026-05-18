import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBmfR-aWuD95SfeODpIAN3WfGCOa2CtOtk",
  authDomain: "live-news-membership.firebaseapp.com",
  projectId: "live-news-membership",
  storageBucket: "live-news-membership.firebasestorage.app",
  messagingSenderId: "148475633383",
  appId: "1:148475633383:web:32c532ff686547efac0c42",
  measurementId: "G-FCEJNP91H4",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let analytics = null;

if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {
      analytics = null;
    });
}

export {
  analytics,
  app,
  auth,
  db,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
};
