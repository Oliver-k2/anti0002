import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyB0NgUxxv_OFBg6B92NvsPKb1cjTNbBH4k",
  authDomain: "anti0002.firebaseapp.com",
  databaseURL: "https://anti0002-default-rtdb.firebaseio.com",
  projectId: "anti0002",
  storageBucket: "anti0002.firebasestorage.app",
  messagingSenderId: "825344572021",
  appId: "1:825344572021:web:5a2f7b8ad639b78a4f563c",
  measurementId: "G-NQ0WQM0G3C"
};

const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getDatabase(app);
