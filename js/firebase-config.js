import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCk8QgFkYt6RcpEq48irUGMJ0ZOv6MkUP0",
  authDomain: "zasswimerclub.firebaseapp.com",
  projectId: "zasswimerclub",
  storageBucket: "zasswimerclub.firebasestorage.app",
  messagingSenderId: "320536146927",
  appId: "1:320536146927:web:6b6dff3b5b82bd481f7c1a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
