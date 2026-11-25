import { showToast } from "./utils.js";

const ROLE_MENUS = {
super_admin: [
    { id: "overview", label: "Ringkasan", module: "./modules/super-admin.js", view: "overview" },
    { id: "verifikasi", label: "Verifikasi & Kelas", module: "./modules/super-admin.js", view: "verifikasi" },
    { id: "users", label: "Pelatih & Role", module: "./modules/super-admin.js", view: "users" },
    { id: "absensi-pelatih", label: "Hadir Pelatih", module: "./modules/super-admin.js", view: "absensi_pelatih" },
    { id: "absensi-siswa", label: "Hadir Atlet", module: "./modules/super-admin.js", view: "absensi_siswa" },
    { id: "database", label: "Database Atlet", module: "./modules/super-admin.js", view: "database" }
  ],
  admin_pelatih: [
    { id: "sesi-kelas", label: "Sesi & PIN/QR", module: "./modules/pelatih.js", view: "sesi" },
    { id: "verifikasi", label: "Verifikasi & Kelas", module: "./modules/super-admin.js", view: "verifikasi" },
    { id: "program", label: "Program Latihan", module: "./modules/pelatih.js", view: "program" },
    { id: "rekap-kelas", label: "Rekap Hadir", module: "./modules/pelatih.js", view: "rekap" }
  ],
  pelatih: [
    { id: "sesi-kelas", label: "Sesi & PIN/QR", module: "./modules/pelatih.js", view: "sesi" },
    { id: "program", label: "Program Latihan", module: "./modules/pelatih.js", view: "program" },
    { id: "rekap-kelas", label: "Rekap Hadir", module: "./modules/pelatih.js", view: "rekap" }
  ],
  orang_tua: [
    { id: "absensi-anak", label: "Absensi & Anak", module: "./modules/orang-tua.js", view: "absensi" },
    { id: "program-info", label: "Jadwal & Program", module: "./modules/orang-tua.js", view: "program_info" },
    { id: "tambah-anak", label: "Daftar Anak Lain", module: "./modules/orang-tua.js", view: "tambah_anak" }
  ]
};

const moduleCache = new Map();
let currentUserContext = null;

async function loadModule(modulePath) {
  if (!moduleCache.has(modulePath)) {
    const mod = await import(modulePath);
    moduleCache.set(modulePath, mod);
  }
  return moduleCache.get(modulePath);
}

export async function navigateTo(menuItem, userProfile) {
  const workspaceEl = document.getElementById("workspace-view");
  const navContainer = document.getElementById("role-nav-items");

  if (!workspaceEl || !menuItem) return;

  // Perbarui gaya tombol tab aktif
  navContainer.querySelectorAll("button[data-nav-id]").forEach((btn) => {
    const isActive = btn.dataset.navId === menuItem.id;
    btn.className = isActive
      ? "px-3 py-1.5 rounded-lg bg-white text-sky-900 font-semibold transition"
      : "px-3 py-1.5 rounded-lg text-sky-100 hover:bg-sky-700/80 font-medium transition";
  });

  workspaceEl.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <div class="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
      <p class="mt-3 text-sm text-slate-500">Memuat ${menuItem.label}...</p>
    </div>
  `;

  try {
    const mod = await loadModule(menuItem.module);
    if (typeof mod.renderView === "function") {
      await mod.renderView({
        container: workspaceEl,
        view: menuItem.view,
        user: userProfile
      });
    } else {
      workspaceEl.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 class="text-lg font-bold text-slate-800">${menuItem.label}</h2>
          <p class="text-sm text-slate-500 mt-1">Modul <code>${menuItem.module}</code> (view: <code>${menuItem.view}</code>) siap dihubungkan.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error("Gagal memuat modul:", err);
    showToast(`Gagal memuat halaman ${menuItem.label}`, "error");
    workspaceEl.innerHTML = `
      <div class="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-6">
        <p class="font-semibold">Terjadi kesalahan saat memuat modul.</p>
        <p class="text-xs mt-1">${err.message}</p>
      </div>
    `;
  }
}

export async function initRoleRouter(userProfile) {
  currentUserContext = userProfile;
  const navSection = document.getElementById("role-nav");
  const navItemsEl = document.getElementById("role-nav-items");
  const menus = ROLE_MENUS[userProfile.role] || ROLE_MENUS.orang_tua;

  navItemsEl.innerHTML = "";
  navSection.classList.remove("hidden");

  menus.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.navId = item.id;
    btn.textContent = item.label;
    btn.className = "px-3 py-1.5 rounded-lg text-sky-100 hover:bg-sky-700/80 font-medium transition";
    btn.addEventListener("click", () => {
      navigateTo(item, currentUserContext);
    });
    navItemsEl.appendChild(btn);
  });

  // Muat tab pertama secara otomatis
  await navigateTo(menus[0], currentUserContext);
}
