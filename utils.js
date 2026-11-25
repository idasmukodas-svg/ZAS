export function getTodayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function generatePinCode(length = 4) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

export function generateSessionToken() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  }
  return Math.random().toString(36).substring(2, 16);
}

export function getRoleLabel(role) {
  const map = {
    super_admin: "Super Admin (Owner)",
    admin_pelatih: "Admin & Pelatih",
    pelatih: "Pelatih",
    orang_tua: "Orang Tua"
  };
  return map[role] || role;
}

export function getStatusBadge(status) {
  const badges = {
    aktif: "bg-emerald-100 text-emerald-800 border-emerald-200",
    pending_verifikasi: "bg-amber-100 text-amber-800 border-amber-200",
    cuti: "bg-slate-100 text-slate-700 border-slate-200",
    non_aktif: "bg-rose-100 text-rose-800 border-rose-200",
    hadir: "bg-emerald-100 text-emerald-800 border-emerald-200",
    izin: "bg-sky-100 text-sky-800 border-sky-200",
    sakit: "bg-amber-100 text-amber-800 border-amber-200",
    alpha: "bg-rose-100 text-rose-800 border-rose-200"
  };
  return badges[status] || "bg-slate-100 text-slate-700 border-slate-200";
}

export function formatTanggalIndo(dateStr) {
  if (!dateStr) return "-";
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm";
    document.body.appendChild(container);
  }

  const colorMap = {
    info: "bg-slate-800 text-white",
    success: "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white",
    warning: "bg-amber-500 text-slate-950"
  };

  const toast = document.createElement("div");
  toast.className = `${colorMap[type] || colorMap.info} px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
