// Firebase setup for Uniquely Soaring.
// This web config is public by design. What keeps the data safe is the
// Firestore security rules, which only let each person see their own client.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDyDA5d9rxgxVWIWlTfUMJiy27IKVI3Bo0",
  authDomain: "uniquely-soaring.firebaseapp.com",
  projectId: "uniquely-soaring",
  storageBucket: "uniquely-soaring.firebasestorage.app",
  messagingSenderId: "780272077414",
  appId: "1:780272077414:web:37c020d91b7caa7441fba7"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
