import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getRoleLabel, showToast } from "./utils.js";
import { initRoleRouter } from "./router.js";

// Referensi Elemen DOM
const loadingScreen = document.getElementById("loading-screen");
const authView = document.getElementById("auth-view");
const workspaceView = document.getElementById("workspace-view");
const appHeader = document.getElementById("app-header");
const userDisplayName = document.getElementById("user-display-name");
const userRoleBadge = document.getElementById("user-role-badge");

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const formLogin = document.getElementById("form-login");
const formRegister = document.getElementById("form-register");
const btnLogout = document.getElementById("btn-logout");

// Switch Tab Login / Register
function switchAuthTab(mode) {
  const isLogin = mode === "login";
  formLogin.classList.toggle("hidden", !isLogin);
  formRegister.classList.toggle("hidden", isLogin);

  tabLogin.className = isLogin
    ? "flex-1 pb-2.5 text-sm font-semibold border-b-2 border-sky-600 text-sky-700"
    : "flex-1 pb-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500";

  tabRegister.className = !isLogin
    ? "flex-1 pb-2.5 text-sm font-semibold border-b-2 border-sky-600 text-sky-700"
    : "flex-1 pb-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500";
}

tabLogin?.addEventListener("click", () => switchAuthTab("login"));
tabRegister?.addEventListener("click", () => switchAuthTab("register"));

// Ambil atau buat profil pengguna di Firestore
async function getOrCreateUserProfile(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return { uid: firebaseUser.uid, ...snap.data() };
  }

  // Cek apakah Super Admin sudah membuat profil pelatih/pengguna berdasarkan email ini
  const normalizedEmail = (firebaseUser.email || "").trim().toLowerCase();
  if (normalizedEmail) {
    const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
    const preSnap = await getDocs(q);
    const preDoc = preSnap.docs.find((d) => d.id !== firebaseUser.uid);

    if (preDoc) {
      const preData = preDoc.data();
      const mergedProfile = {
        ...preData,
        email: normalizedEmail,
        status_akun: preData.status_akun || "aktif",
        created_at: preData.created_at || new Date().toISOString(),
        linked_auth_at: new Date().toISOString()
      };
      await setDoc(userRef, mergedProfile);
      if (preDoc.id.startsWith("coach_") || preDoc.id.startsWith("usr_")) {
        await deleteDoc(doc(db, "users", preDoc.id));
      }
      return { uid: firebaseUser.uid, ...mergedProfile };
    }
  }

  const defaultProfile = {
    nama: (firebaseUser.email || "user").split("@")[0],
    email: normalizedEmail,
    no_wa: "",
    role: "orang_tua",
    assigned_classes: [],
    linked_participants: [],
    status_akun: "aktif",
    created_at: new Date().toISOString()
  };

  await setDoc(userRef, defaultProfile);
  return { uid: firebaseUser.uid, ...defaultProfile };
}

// Submit Login
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const submitBtn = formLogin.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Berhasil masuk ke sistem", "success");
  } catch (err) {
    console.error("Login error:", err);
    showToast("Email atau password tidak valid.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Masuk ke Sistem";
  }
});

// Submit Pendaftaran Orang Tua + Peserta Baru
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = formRegister.querySelector('button[type="submit"]');

  const parentName = document.getElementById("reg-parent-name").value.trim();
  const wa = document.getElementById("reg-wa").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  const childName = document.getElementById("reg-child-name").value.trim();
  const childDob = document.getElementById("reg-child-dob").value;
  const childGender = document.getElementById("reg-child-gender").value;
  const category = document.getElementById("reg-category").value;
  const medical = document.getElementById("reg-medical").value.trim() || "Tidak ada catatan khusus";

  submitBtn.disabled = true;
  submitBtn.textContent = "Mengirim pendaftaran...";

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    const participantId = `pst_${uid.slice(0, 8)}_${Date.now().toString().slice(-4)}`;

    const batch = writeBatch(db);

    const userDocRef = doc(db, "users", uid);
    batch.set(userDocRef, {
      nama: parentName,
      email,
      no_wa: wa,
      role: "orang_tua",
      assigned_classes: [],
      linked_participants: [participantId],
      status_akun: "aktif",
      created_at: new Date().toISOString()
    });

    const participantDocRef = doc(db, "participants", participantId);
    batch.set(participantDocRef, {
      nomor_induk: "",
      nama_lengkap: childName,
      nama_panggilan: childName.split(" ")[0],
      tanggal_lahir: childDob,
      jenis_kelamin: childGender,
      kelompok_umur: "",
      kategori: category, // "atlet" | "siswa"
      class_id: "",
      parent_uid: uid,
      nama_orang_tua: parentName,
      no_wa_darurat: wa,
      catatan_medis: medical,
      catatan_best_time: {},
      status_keanggotaan: "pending_verifikasi",
      tanggal_gabung: new Date().toISOString().slice(0, 10),
      created_server_at: serverTimestamp()
    });

    await batch.commit();
    showToast("Pendaftaran berhasil! Menunggu verifikasi admin/pelatih.", "success");
    formRegister.reset();
  } catch (err) {
    console.error("Register error:", err);
    const message =
      err.code === "auth/email-already-in-use"
        ? "Email sudah terdaftar. Silakan masuk menggunakan akun tersebut."
        : `Pendaftaran gagal: ${err.message}`;
    showToast(message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Kirim Pendaftaran";
  }
});

// Logout
btnLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showToast("Anda telah keluar dari sesi.", "info");
  } catch (err) {
    showToast("Gagal keluar dari sesi.", "error");
  }
});

// Listener Status Autentikasi Global
onAuthStateChanged(auth, async (firebaseUser) => {
  loadingScreen.classList.add("hidden");

  if (!firebaseUser) {
    appHeader.classList.add("hidden");
    workspaceView.classList.add("hidden");
    workspaceView.innerHTML = "";
    authView.classList.remove("hidden");
    return;
  }

  try {
    const profile = await getOrCreateUserProfile(firebaseUser);
    authView.classList.add("hidden");
    appHeader.classList.remove("hidden");
    workspaceView.classList.remove("hidden");

    userDisplayName.textContent = profile.nama || firebaseUser.email;
    userRoleBadge.textContent = getRoleLabel(profile.role);

    await initRoleRouter(profile);
  } catch (err) {
    console.error("Gagal memuat profil pengguna:", err);
    showToast("Gagal memuat data profil akun.", "error");
  }
});
