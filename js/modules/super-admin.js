import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getTodayISO,
  getRoleLabel,
  getStatusBadge,
  formatTanggalIndo,
  showToast
} from "../utils.js";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugifyId(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Hitung usia tahun berjalan (per 1 Januari tahun ini / standar kompetisi) & tentukan KU
function calculateAgeAndKU(dobString) {
  if (!dobString) return { age: null, ku: "" };
  const birthYear = Number(String(dobString).slice(0, 4));
  if (!birthYear || Number.isNaN(birthYear)) return { age: null, ku: "" };

  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - birthYear);

  let ku = "Senior";
  if (age <= 9) ku = "KU-5";
  else if (age <= 11) ku = "KU-4";
  else if (age <= 13) ku = "KU-3";
  else if (age <= 15) ku = "KU-2";
  else if (age <= 18) ku = "KU-1";

  return { age, ku };
}

function downloadCsv(filename, rows) {
  if (!rows || !rows.length) {
    showToast("Tidak ada data untuk diekspor.", "warning");
    return;
  }
  const csvContent = rows
    .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchClubState() {
  const [usersSnap, classesSnap, participantsSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "classes")),
    getDocs(collection(db, "participants"))
  ]);

  const users = usersSnap.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }));
  const classes = classesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const participants = participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const classMap = Object.fromEntries(classes.map((c) => [c.id, c]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return { users, classes, participants, classMap, userMap };
}

// ============================================================================
// 1. OVERVIEW / RINGKASAN EKSEKUTIF
// ============================================================================
async function renderOverview(container, state) {
  const { users, classes, participants } = state;
  const activeAtlet = participants.filter((p) => p.status_keanggotaan === "aktif").length;
  const pendingCount = participants.filter((p) => p.status_keanggotaan === "pending_verifikasi").length;
  const coachCount = users.filter((u) => ["pelatih", "admin_pelatih"].includes(u.role)).length;

  const todayStr = getTodayISO();
  const [attSnap, coachAttSnap] = await Promise.all([
    getDocs(query(collection(db, "attendances"), where("tanggal", "==", todayStr))),
    getDocs(query(collection(db, "coach_attendances"), where("tanggal", "==", todayStr)))
  ]);

  const hadirAtletHariIni = attSnap.docs
    .map((d) => d.data())
    .filter((a) => a.status_kehadiran === "hadir").length;
  const hadirPelatihHariIni = coachAttSnap.docs
    .map((d) => d.data())
    .filter((a) => a.status_kehadiran === "hadir").length;

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <h2 class="text-xl font-bold text-slate-800">Ringkasan Operasional Klub</h2>
        <p class="text-sm text-slate-500">Tanggal acuan: ${formatTanggalIndo(todayStr)}</p>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Total Atlet Aktif</p>
          <p class="text-2xl font-bold text-sky-700 mt-1">${activeAtlet}</p>
          <p class="text-xs text-emerald-700 mt-1">Hadir hari ini: ${hadirAtletHariIni}</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Pelatih Aktif</p>
          <p class="text-2xl font-bold text-slate-800 mt-1">${coachCount}</p>
          <p class="text-xs text-emerald-700 mt-1">Hadir melatih hari ini: ${hadirPelatihHariIni}</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Kelas Latihan</p>
          <p class="text-2xl font-bold text-indigo-700 mt-1">${classes.length}</p>
          <p class="text-xs text-slate-500 mt-1">Kelompok latihan aktif</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Menunggu Verifikasi</p>
          <p class="text-2xl font-bold text-amber-600 mt-1">${pendingCount}</p>
          <p class="text-xs text-slate-500 mt-1">Pendaftar baru</p>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 class="font-bold text-slate-800 mb-3">Daftar Kelas & Pelatih Penanggung Jawab</h3>
        ${
          classes.length === 0
            ? `<p class="text-sm text-slate-500">Belum ada kelas dibuat. Buka tab <strong>Verifikasi & Kelas</strong> untuk menambahkan kelas.</p>`
            : `
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
              <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th class="py-2.5 px-3">Nama Kelas</th>
                  <th class="py-2.5 px-3">Pelatih</th>
                  <th class="py-2.5 px-3">Jumlah Atlet</th>
                  <th class="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${classes
                  .map((cls) => {
                    const coachNames = (cls.coach_uids || [])
                      .map((uid) => state.userMap[uid]?.nama || uid)
                      .join(", ");
                    const memberCount = participants.filter((p) => p.class_id === cls.id).length;
                    return `
                      <tr>
                        <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(cls.nama_kelas)}</td>
                        <td class="py-2.5 px-3 text-slate-600">${escapeHtml(coachNames || "Belum ditugaskan")}</td>
                        <td class="py-2.5 px-3">${memberCount}${cls.kapasitas_maks ? ` / ${cls.kapasitas_maks}` : ""}</td>
                        <td class="py-2.5 px-3">
                          <span class="px-2 py-0.5 text-xs rounded-full border ${getStatusBadge(cls.status || "aktif")}">
                            ${escapeHtml(cls.status || "aktif")}
                          </span>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>`
        }
      </div>
    </div>
  `;
}

// ============================================================================
// 2. VERIFIKASI PENDAFTAR & MANAJEMEN KELAS + PENUGASAN PELATIH
// ============================================================================
async function renderVerifikasiDanKelas(container, state, user) {
  const { users, classes, participants } = state;
  const pendingList = participants.filter((p) => p.status_keanggotaan === "pending_verifikasi");
  const pelatihUsers = users.filter((u) => ["pelatih", "admin_pelatih", "super_admin"].includes(u.role));

  container.innerHTML = `
    <div class="space-y-8">
      <div class="bg-white rounded-2xl border border-slate-200 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-bold text-slate-800">Verifikasi Pendaftar Atlet Baru</h2>
            <p class="text-xs text-slate-500">Tetapkan kelas latihan, kelompok usia (KU), asal sekolah, dan nomor induk atlet.</p>
          </div>
          <span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            ${pendingList.length} Pending
          </span>
        </div>

        ${
          pendingList.length === 0
            ? `<p class="text-sm text-slate-500 py-3">Tidak ada pendaftar baru yang menunggu verifikasi.</p>`
            : `
          <div class="space-y-4">
            ${pendingList
              .map((pst) => {
                const autoKU = pst.kelompok_umur || calculateAgeAndKU(pst.tanggal_lahir).ku;
                return `
                  <div class="border border-slate-200 rounded-xl p-4 bg-slate-50/60" data-verify-card="${pst.id}">
                    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-3 border-b border-slate-200">
                      <div>
                        <h3 class="font-bold text-slate-800">${escapeHtml(pst.nama_lengkap)} <span class="text-xs font-normal text-slate-500">(${escapeHtml(pst.jenis_kelamin || "-")}, Lahir: ${escapeHtml(pst.tanggal_lahir || "-")})</span></h3>
                        <p class="text-xs text-slate-600 mt-0.5">Orang Tua: <strong>${escapeHtml(pst.nama_orang_tua || "-")}</strong> · WA: ${escapeHtml(pst.no_wa_darurat || "-")} · Medis: ${escapeHtml(pst.catatan_medis || "-")}</p>
                      </div>
                      <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 w-fit">Calon Atlet</span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas Latihan</label>
                        <select class="ver-kelas w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                          <option value="">-- Pilih Kelas --</option>
                          ${classes
                            .map(
                              (c) =>
                                `<option value="${c.id}" ${pst.class_id === c.id ? "selected" : ""}>${escapeHtml(c.nama_kelas)}</option>`
                            )
                            .join("")}
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Kelompok Usia (KU)</label>
                        <select class="ver-ku w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                          <option value="KU-5" ${autoKU === "KU-5" ? "selected" : ""}>KU-5 (≤ 9 Thn)</option>
                          <option value="KU-4" ${autoKU === "KU-4" ? "selected" : ""}>KU-4 (10-11 Thn)</option>
                          <option value="KU-3" ${autoKU === "KU-3" ? "selected" : ""}>KU-3 (12-13 Thn)</option>
                          <option value="KU-2" ${autoKU === "KU-2" ? "selected" : ""}>KU-2 (14-15 Thn)</option>
                          <option value="KU-1" ${autoKU === "KU-1" ? "selected" : ""}>KU-1 (16-18 Thn)</option>
                          <option value="Senior" ${autoKU === "Senior" ? "selected" : ""}>Senior (≥ 19 Thn)</option>
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Asal Sekolah</label>
                        <input type="text" class="ver-school w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" value="${escapeHtml(pst.asal_sekolah || "")}" placeholder="Nama sekolah atlet" />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">No. Induk Atlet</label>
                        <input type="text" class="ver-nis w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" value="${escapeHtml(pst.nomor_induk || "")}" placeholder="Contoh: CLB-2026-010" />
                      </div>
                    </div>

                    <div class="flex justify-end gap-2 mt-3">
                      <button type="button" data-action="reject-pst" data-id="${pst.id}" class="px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50">
                        Tolak / Non-Aktifkan
                      </button>
                      <button type="button" data-action="approve-pst" data-id="${pst.id}" class="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                        Setujui & Masukkan Kelas
                      </button>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>`
        }
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form id="form-create-class" class="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 h-fit">
          <h3 class="text-base font-bold text-slate-800">Buat Kelas Latihan Baru</h3>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Kelas</label>
            <input type="text" id="cls-name" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Prestasi Pagi / Pembinaan Sore" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Kapasitas Maksimal Atlet</label>
            <input type="number" id="cls-cap" min="1" value="20" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Jadwal Ringkas</label>
            <input type="text" id="cls-schedule" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Senin, Rabu, Sabtu (05:30 - 07:30)" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Pelatih Penanggung Jawab</label>
            <select id="cls-coach" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">-- Pilih Pelatih Awal (Opsional) --</option>
              ${pelatihUsers
                .map((u) => `<option value="${u.uid}">${escapeHtml(u.nama)} (${escapeHtml(getRoleLabel(u.role))})</option>`)
                .join("")}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Deskripsi</label>
            <textarea id="cls-desc" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Fokus latihan atau target kelas..."></textarea>
          </div>
          <button type="submit" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2.5 rounded-lg text-sm transition">
            Simpan Kelas
          </button>
        </form>

        <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 class="text-base font-bold text-slate-800">Penugasan Pelatih per Kelas</h3>
          ${
            classes.length === 0
              ? `<p class="text-sm text-slate-500">Belum ada kelas terdaftar.</p>`
              : `
            <div class="space-y-3">
              ${classes
                .map((cls) => {
                  const assignedIds = cls.coach_uids || [];
                  const assignedBadges = assignedIds
                    .map(
                      (uid) => `
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-sky-50 text-sky-800 border border-sky-200">
                      ${escapeHtml(state.userMap[uid]?.nama || uid)}
                      <button type="button" data-action="unassign-coach" data-class-id="${cls.id}" data-coach-uid="${uid}" class="text-rose-600 hover:text-rose-800 font-bold" title="Hapus penugasan">&times;</button>
                    </span>
                  `
                    )
                    .join("");

                  return `
                    <div class="border border-slate-200 rounded-xl p-4">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="font-bold text-slate-800">${escapeHtml(cls.nama_kelas)}</span>
                        <span class="text-xs text-slate-500">${escapeHtml(cls.jadwal_teks || "")}</span>
                      </div>
                      <div class="flex flex-wrap gap-1.5 mt-2.5">
                        ${assignedBadges || `<span class="text-xs text-slate-400">Belum ada pelatih ditugaskan</span>`}
                      </div>
                      <div class="flex items-center gap-2 mt-3">
                        <select data-coach-select="${cls.id}" class="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
                          <option value="">-- Tambah Pelatih ke Kelas --</option>
                          ${pelatihUsers
                            .filter((u) => !assignedIds.includes(u.uid))
                            .map((u) => `<option value="${u.uid}">${escapeHtml(u.nama)} (${escapeHtml(getRoleLabel(u.role))})</option>`)
                            .join("")}
                        </select>
                        <button type="button" data-action="assign-coach" data-class-id="${cls.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white">
                          Tugaskan
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>`
          }
        </div>
      </div>
    </div>
  `;

  container.querySelector("#form-create-class")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const namaKelas = container.querySelector("#cls-name").value.trim();
    const kapasitasMaks = Number(container.querySelector("#cls-cap").value) || 20;
    const jadwalTeks = container.querySelector("#cls-schedule").value.trim();
    const coachUid = container.querySelector("#cls-coach").value;
    const deskripsi = container.querySelector("#cls-desc").value.trim();

    if (!namaKelas) return;
    const baseSlug = slugifyId(namaKelas) || "kelas";
    const classId = `kls_${baseSlug}_${Date.now().toString().slice(-4)}`;
    const coachUids = coachUid ? [coachUid] : [];

    try {
      await setDoc(doc(db, "classes", classId), {
        nama_kelas: namaKelas,
        jenis_kelas: "atlet",
        deskripsi,
        jadwal_teks: jadwalTeks,
        coach_uids: coachUids,
        kapasitas_maks: kapasitasMaks,
        status: "aktif",
        created_by: user.uid,
        created_at: new Date().toISOString()
      });

      if (coachUid) {
        await updateDoc(doc(db, "users", coachUid), {
          assigned_classes: arrayUnion(classId)
        });
      }

      showToast(`Kelas "${namaKelas}" berhasil dibuat.`, "success");
      const nextState = await fetchClubState();
      await renderVerifikasiDanKelas(container, nextState, user);
    } catch (err) {
      console.error(err);
      showToast("Gagal membuat kelas baru.", "error");
    }
  });

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "approve-pst") {
      const pstId = btn.dataset.id;
      const card = container.querySelector(`[data-verify-card="${pstId}"]`);
      const classId = card.querySelector(".ver-kelas").value;
      const kelompokUmur = card.querySelector(".ver-ku").value;
      const asalSekolah = card.querySelector(".ver-school").value.trim();
      const nomorInduk = card.querySelector(".ver-nis").value.trim() || `CLB-${new Date().getFullYear()}-${pstId.slice(-4).toUpperCase()}`;

      if (!classId) {
        showToast("Pilih kelas latihan terlebih dahulu sebelum menyetujui.", "warning");
        return;
      }

      try {
        await updateDoc(doc(db, "participants", pstId), {
          kategori: "atlet",
          class_id: classId,
          kelompok_umur: kelompokUmur,
          asal_sekolah: asalSekolah,
          nomor_induk: nomorInduk,
          status_keanggotaan: "aktif",
          verified_by: user.uid,
          verified_at: new Date().toISOString()
        });
        showToast("Atlet diverifikasi dan dimasukkan ke kelas.", "success");
        const nextState = await fetchClubState();
        await renderVerifikasiDanKelas(container, nextState, user);
      } catch (err) {
        console.error(err);
        showToast("Gagal memverifikasi atlet.", "error");
      }
    }

    if (action === "reject-pst") {
      const pstId = btn.dataset.id;
      try {
        await updateDoc(doc(db, "participants", pstId), {
          status_keanggotaan: "non_aktif",
          verified_by: user.uid,
          verified_at: new Date().toISOString()
        });
        showToast("Pendaftaran ditandai non-aktif.", "info");
        const nextState = await fetchClubState();
        await renderVerifikasiDanKelas(container, nextState, user);
      } catch (err) {
        console.error(err);
        showToast("Gagal memperbarui status pendaftaran.", "error");
      }
    }

    if (action === "assign-coach") {
      const classId = btn.dataset.classId;
      const selectEl = container.querySelector(`select[data-coach-select="${classId}"]`);
      const coachUid = selectEl?.value;
      if (!coachUid) {
        showToast("Pilih pelatih terlebih dahulu.", "warning");
        return;
      }
      try {
        await updateDoc(doc(db, "classes", classId), {
          coach_uids: arrayUnion(coachUid)
        });
        await updateDoc(doc(db, "users", coachUid), {
          assigned_classes: arrayUnion(classId)
        });
        showToast("Pelatih berhasil ditugaskan ke kelas.", "success");
        const nextState = await fetchClubState();
        await renderVerifikasiDanKelas(container, nextState, user);
      } catch (err) {
        console.error(err);
        showToast("Gagal menugaskan pelatih.", "error");
      }
    }

    if (action === "unassign-coach") {
      const classId = btn.dataset.classId;
      const coachUid = btn.dataset.coachUid;
      try {
        await updateDoc(doc(db, "classes", classId), {
          coach_uids: arrayRemove(coachUid)
        });
        await updateDoc(doc(db, "users", coachUid), {
          assigned_classes: arrayRemove(classId)
        });
        showToast("Penugasan pelatih dihapus dari kelas.", "info");
        const nextState = await fetchClubState();
        await renderVerifikasiDanKelas(container, nextState, user);
      } catch (err) {
        console.error(err);
        showToast("Gagal menghapus penugasan pelatih.", "error");
      }
    }
  });
}

// ============================================================================
// 3. INPUT DATABASE PELATIH & PENGATURAN ROLE
// ============================================================================
async function renderPelatihDanRole(container, state, currentUser) {
  const { users, classes } = state;

  container.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <form id="form-add-coach" class="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 h-fit">
        <div>
          <h2 class="text-base font-bold text-slate-800">Tambah Pelatih ke Database</h2>
          <p class="text-xs text-slate-500 mt-0.5">Input data pelatih langsung di aplikasi. Saat pelatih login dengan email ini, role & kelas otomatis tersinkron.</p>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Pelatih</label>
          <input type="text" id="coach-name" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Nama pelatih" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Email Akun Pelatih</label>
          <input type="email" id="coach-email" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="pelatih@email.com" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">No. WhatsApp</label>
          <input type="tel" id="coach-wa" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="08..." />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Role</label>
          <select id="coach-role" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="pelatih" selected>3. Pelatih</option>
            <option value="admin_pelatih">2. Admin & Pelatih</option>
            <option value="super_admin">1. Super Admin</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas Awal yang Diampu (Opsional)</label>
          <select id="coach-class" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">-- Belum Ditugaskan --</option>
            ${classes.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
          </select>
        </div>

        <button type="submit" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2.5 rounded-lg text-sm transition">
          Simpan Pelatih
        </button>
      </form>

      <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Database Pengguna & Hak Akses</h2>
          <p class="text-xs text-slate-500">Kelola peran Super Admin, Admin & Pelatih, Pelatih, dan Orang Tua.</p>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm text-left">
            <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Nama</th>
                <th class="py-2.5 px-3">Email / WA</th>
                <th class="py-2.5 px-3">Role</th>
                <th class="py-2.5 px-3">Ubah Role</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${users
                .map(
                  (u) => `
                <tr>
                  <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(u.nama || "-")}</td>
                  <td class="py-2.5 px-3 text-slate-600">
                    <div>${escapeHtml(u.email || "-")}</div>
                    <div class="text-xs text-slate-400">${escapeHtml(u.no_wa || "")}</div>
                  </td>
                  <td class="py-2.5 px-3">
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                      ${escapeHtml(getRoleLabel(u.role))}
                    </span>
                  </td>
                  <td class="py-2.5 px-3">
                    <div class="flex items-center gap-2">
                      <select data-role-select="${u.uid}" class="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white" ${u.uid === currentUser.uid ? "disabled" : ""}>
                        <option value="super_admin" ${u.role === "super_admin" ? "selected" : ""}>1. Super Admin</option>
                        <option value="admin_pelatih" ${u.role === "admin_pelatih" ? "selected" : ""}>2. Admin & Pelatih</option>
                        <option value="pelatih" ${u.role === "pelatih" ? "selected" : ""}>3. Pelatih</option>
                        <option value="orang_tua" ${u.role === "orang_tua" ? "selected" : ""}>4. Orang Tua</option>
                      </select>
                      ${
                        u.uid === currentUser.uid
                          ? `<span class="text-xs text-slate-400">Akun aktif</span>`
                          : `<button type="button" data-action="save-role" data-uid="${u.uid}" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">Simpan</button>`
                      }
                    </div>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#form-add-coach")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nama = container.querySelector("#coach-name").value.trim();
    const email = container.querySelector("#coach-email").value.trim().toLowerCase();
    const noWa = container.querySelector("#coach-wa").value.trim();
    const role = container.querySelector("#coach-role").value;
    const classId = container.querySelector("#coach-class").value;

    if (!nama || !email) return;

    const coachDocId = `coach_${slugifyId(nama) || "pelatih"}_${Date.now().toString().slice(-4)}`;
    const assignedClasses = classId ? [classId] : [];

    try {
      await setDoc(doc(db, "users", coachDocId), {
        nama,
        email,
        no_wa: noWa,
        role,
        assigned_classes: assignedClasses,
        linked_participants: [],
        status_akun: "aktif",
        created_by: currentUser.uid,
        created_at: new Date().toISOString()
      });

      if (classId) {
        await updateDoc(doc(db, "classes", classId), {
          coach_uids: arrayUnion(coachDocId)
        });
      }

      showToast(`Pelatih "${nama}" tersimpan ke database.`, "success");
      const nextState = await fetchClubState();
      await renderPelatihDanRole(container, nextState, currentUser);
    } catch (err) {
      console.error(err);
      showToast("Gagal menambahkan pelatih.", "error");
    }
  });

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest('button[data-action="save-role"]');
    if (!btn) return;
    const uid = btn.dataset.uid;
    const selectEl = container.querySelector(`select[data-role-select="${uid}"]`);
    const newRole = selectEl?.value;
    if (!newRole) return;

    try {
      await updateDoc(doc(db, "users", uid), { role: newRole });
      showToast(`Role pengguna diperbarui menjadi ${getRoleLabel(newRole)}.`, "success");
      const nextState = await fetchClubState();
      await renderPelatihDanRole(container, nextState, currentUser);
    } catch (err) {
      console.error(err);
      showToast("Gagal mengubah role pengguna.", "error");
    }
  });
}

// ============================================================================
// 4. DAFTAR HADIR PELATIH (UNTUK URUSAN PENGGAJIHAN / HONOR)
// ============================================================================
async function renderRekapHadirPelatih(container, state) {
  const { classes, classMap, userMap } = state;
  const todayStr = getTodayISO();

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Daftar Hadir Pelatih (Penggajihan)</h2>
          <p class="text-xs text-slate-500">Rekap kehadiran pelatih per tanggal & kelas untuk keperluan perhitungan honor/penggajihan.</p>
        </div>
        <button type="button" id="btn-export-coach-att" class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white w-fit">
          Export CSV Hadir Pelatih
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal</label>
          <input type="date" id="filter-coach-date" value="${todayStr}" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas</label>
          <select id="filter-coach-class" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua Kelas</option>
            ${classes.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
          </select>
        </div>
        <div class="flex items-end">
          <button type="button" id="btn-load-coach-att" class="w-full px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            Tampilkan Rekap Pelatih
          </button>
        </div>
      </div>

      <div id="coach-att-table-wrap" class="overflow-x-auto">
        <p class="text-sm text-slate-500 py-4">Memuat daftar hadir pelatih...</p>
      </div>
    </div>
  `;

  let latestCoachRows = [];

  async function loadCoachAttendance() {
    const selectedDate = container.querySelector("#filter-coach-date").value;
    const selectedClass = container.querySelector("#filter-coach-class").value;
    const wrap = container.querySelector("#coach-att-table-wrap");

    const q = selectedDate
      ? query(collection(db, "coach_attendances"), where("tanggal", "==", selectedDate))
      : collection(db, "coach_attendances");

    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (selectedClass) {
      rows = rows.filter((r) => r.class_id === selectedClass);
    }

    latestCoachRows = rows;

    if (rows.length === 0) {
      wrap.innerHTML = `<p class="text-sm text-slate-500 py-4">Belum ada catatan kehadiran pelatih pada filter yang dipilih.</p>`;
      return;
    }

    const hadirTotal = rows.filter((r) => r.status_kehadiran === "hadir").length;

    wrap.innerHTML = `
      <div class="flex flex-wrap gap-2 mb-3 text-xs font-semibold">
        <span class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Total Sesi Hadir: ${hadirTotal}</span>
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">Total Tercatat: ${rows.length}</span>
      </div>
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3">Tanggal</th>
            <th class="py-2.5 px-3">Nama Pelatih</th>
            <th class="py-2.5 px-3">Kelas</th>
            <th class="py-2.5 px-3">Status</th>
            <th class="py-2.5 px-3">Waktu Tercatat</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows
            .map(
              (r) => `
            <tr>
              <td class="py-2.5 px-3 whitespace-nowrap">${escapeHtml(r.tanggal || "-")}</td>
              <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(r.nama_pelatih || userMap[r.coach_uid]?.nama || r.coach_uid || "-")}</td>
              <td class="py-2.5 px-3 text-slate-600">${escapeHtml(classMap[r.class_id]?.nama_kelas || r.class_id || "-")}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(r.status_kehadiran || "hadir")}">
                  ${escapeHtml(r.status_kehadiran || "hadir")}
                </span>
              </td>
              <td class="py-2.5 px-3 text-xs text-slate-500">${escapeHtml(r.waktu_catat || "-")}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  container.querySelector("#btn-load-coach-att")?.addEventListener("click", loadCoachAttendance);
  container.querySelector("#btn-export-coach-att")?.addEventListener("click", () => {
    const csvRows = [
      ["Tanggal", "Nama Pelatih", "Kelas", "Status Kehadiran", "Waktu Tercatat"],
      ...latestCoachRows.map((r) => [
        r.tanggal || "",
        r.nama_pelatih || userMap[r.coach_uid]?.nama || r.coach_uid || "",
        classMap[r.class_id]?.nama_kelas || r.class_id || "",
        r.status_kehadiran || "hadir",
        r.waktu_catat || ""
      ])
    ];
    downloadCsv(`rekap-hadir-pelatih-${container.querySelector("#filter-coach-date").value || "all"}.csv`, csvRows);
  });

  await loadCoachAttendance();
}

// ============================================================================
// 5. DAFTAR HADIR ATLET (PEMBAYARAN, KU, ASAL SEKOLAH & CATATAN PRESTASI)
// ============================================================================
async function renderRekapHadirAtlet(container, state) {
  const { classes, participants, classMap } = state;
  const todayStr = getTodayISO();
  const participantMap = Object.fromEntries(participants.map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Daftar Hadir Atlet (Pembayaran & Catatan Prestasi)</h2>
          <p class="text-xs text-slate-500">Pantau kehadiran atlet per tanggal, kelas, dan KU beserta status pembayaran dan catatan prestasi.</p>
        </div>
        <button type="button" id="btn-export-atlet-att" class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white w-fit">
          Export CSV Hadir Atlet
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal</label>
          <input type="date" id="filter-atlet-date" value="${todayStr}" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas</label>
          <select id="filter-atlet-class" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua Kelas</option>
            ${classes.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Filter KU (Usia)</label>
          <select id="filter-atlet-ku" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua KU</option>
            <option value="KU-5">KU-5 (≤ 9 Thn)</option>
            <option value="KU-4">KU-4 (10-11 Thn)</option>
            <option value="KU-3">KU-3 (12-13 Thn)</option>
            <option value="KU-2">KU-2 (14-15 Thn)</option>
            <option value="KU-1">KU-1 (16-18 Thn)</option>
            <option value="Senior">Senior (≥ 19 Thn)</option>
          </select>
        </div>
        <div class="flex items-end">
          <button type="button" id="btn-load-atlet-att" class="w-full px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            Tampilkan Rekap Atlet
          </button>
        </div>
      </div>

      <div id="atlet-att-table-wrap" class="overflow-x-auto">
        <p class="text-sm text-slate-500 py-4">Memuat daftar hadir atlet...</p>
      </div>
    </div>
  `;

  let latestAtletRows = [];

  async function loadAtletAttendance() {
    const selectedDate = container.querySelector("#filter-atlet-date").value;
    const selectedClass = container.querySelector("#filter-atlet-class").value;
    const selectedKu = container.querySelector("#filter-atlet-ku").value;
    const wrap = container.querySelector("#atlet-att-table-wrap");

    const q = selectedDate
      ? query(collection(db, "attendances"), where("tanggal", "==", selectedDate))
      : collection(db, "attendances");

    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (selectedClass) {
      rows = rows.filter((r) => r.class_id === selectedClass);
    }

    if (selectedKu) {
      rows = rows.filter((r) => {
        const pst = participantMap[r.participant_id] || {};
        const ku = pst.kelompok_umur || calculateAgeAndKU(pst.tanggal_lahir).ku;
        return ku === selectedKu;
      });
    }

    latestAtletRows = rows;

    if (rows.length === 0) {
      wrap.innerHTML = `<p class="text-sm text-slate-500 py-4">Belum ada catatan kehadiran atlet pada filter yang dipilih.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3">Tanggal</th>
            <th class="py-2.5 px-3">Nama Atlet</th>
            <th class="py-2.5 px-3">KU & Sekolah</th>
            <th class="py-2.5 px-3">Kelas</th>
            <th class="py-2.5 px-3">Hadir</th>
            <th class="py-2.5 px-3">Pembayaran / Iuran</th>
            <th class="py-2.5 px-3">Catatan Prestasi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows
            .map((r) => {
              const pst = participantMap[r.participant_id] || {};
              const kuLabel = pst.kelompok_umur || calculateAgeAndKU(pst.tanggal_lahir).ku || "-";
              return `
                <tr>
                  <td class="py-2.5 px-3 whitespace-nowrap">${escapeHtml(r.tanggal || "-")}</td>
                  <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(r.nama_peserta || pst.nama_lengkap || r.participant_id)}</td>
                  <td class="py-2.5 px-3 text-xs">
                    <span class="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-bold">${escapeHtml(kuLabel)}</span>
                    <div class="text-slate-500 mt-0.5">${escapeHtml(pst.asal_sekolah || "-")}</div>
                  </td>
                  <td class="py-2.5 px-3 text-slate-600">${escapeHtml(classMap[r.class_id]?.nama_kelas || r.class_id || "-")}</td>
                  <td class="py-2.5 px-3">
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(r.status_kehadiran)}">
                      ${escapeHtml(r.status_kehadiran || "-")}
                    </span>
                  </td>
                  <td class="py-2.5 px-3 text-xs font-semibold text-slate-700">${escapeHtml(pst.status_pembayaran || "Belum dicatat")}</td>
                  <td class="py-2.5 px-3 text-xs text-slate-600">${escapeHtml(pst.catatan_prestasi || "-")}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  container.querySelector("#btn-load-atlet-att")?.addEventListener("click", loadAtletAttendance);
  container.querySelector("#btn-export-atlet-att")?.addEventListener("click", () => {
    const csvRows = [
      ["Tanggal", "Nama Atlet", "Tanggal Lahir", "KU", "Asal Sekolah", "Kelas", "Status Kehadiran", "Status Pembayaran", "Catatan Prestasi"],
      ...latestAtletRows.map((r) => {
        const pst = participantMap[r.participant_id] || {};
        const kuLabel = pst.kelompok_umur || calculateAgeAndKU(pst.tanggal_lahir).ku || "";
        return [
          r.tanggal || "",
          r.nama_peserta || pst.nama_lengkap || r.participant_id || "",
          pst.tanggal_lahir || "",
          kuLabel,
          pst.asal_sekolah || "",
          classMap[r.class_id]?.nama_kelas || r.class_id || "",
          r.status_kehadiran || "",
          pst.status_pembayaran || "Belum dicatat",
          pst.catatan_prestasi || ""
        ];
      })
    ];
    downloadCsv(`rekap-hadir-atlet-${container.querySelector("#filter-atlet-date").value || "all"}.csv`, csvRows);
  });

  await loadAtletAttendance();
}

// ============================================================================
// 6. INPUT & KELOLA DATABASE ATLET RESMI (TANGGAL LAHIR, SEKOLAH, KU, PRESTASI)
// ============================================================================
async function renderDatabaseAtlet(container, state, user) {
  const { participants, classes } = state;

  container.innerHTML = `
    <div class="space-y-6">
      <form id="form-add-participant" class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Tambah Atlet Resmi ke Database Klub</h2>
          <p class="text-xs text-slate-500">Semua anggota tercatat sebagai Atlet resmi. Tanggal lahir wajib diisi untuk pengelompokan Kategori Usia (KU) dan seleksi lomba.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Atlet *</label>
            <input type="text" id="pst-name" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Nama lengkap sesuai akta/KK" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal Lahir *</label>
            <input type="date" id="pst-dob" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Kategori Usia (KU)</label>
            <select id="pst-ku" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="AUTO">Otomatis dari Tanggal Lahir</option>
              <option value="KU-5">KU-5 (≤ 9 Thn)</option>
              <option value="KU-4">KU-4 (10-11 Thn)</option>
              <option value="KU-3">KU-3 (12-13 Thn)</option>
              <option value="KU-2">KU-2 (14-15 Thn)</option>
              <option value="KU-1">KU-1 (16-18 Thn)</option>
              <option value="Senior">Senior (≥ 19 Thn)</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Asal Sekolah *</label>
            <input type="text" id="pst-school" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: SDN 1 Singaparna / SMPN 1..." />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Jenis Kelamin</label>
            <select id="pst-gender" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="L">Putra (L)</option>
              <option value="P">Putri (P)</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas Latihan</label>
            <select id="pst-class" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">-- Pilih Kelas --</option>
              ${classes.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">No. Induk Atlet</label>
            <input type="text" id="pst-nis" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: CLB-2026-001" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Orang Tua & No. WA</label>
            <div class="flex gap-1.5">
              <input type="text" id="pst-parent" class="w-1/2 px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Nama Ortu" />
              <input type="tel" id="pst-wa" class="w-1/2 px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="08..." />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Status Pembayaran / Iuran</label>
            <select id="pst-payment" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="Lunas">Lunas</option>
              <option value="Belum Lunas">Belum Lunas</option>
              <option value="Beasiswa / Khusus">Beasiswa / Khusus</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Catatan Prestasi / Best Time</label>
            <input type="text" id="pst-achievement" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Juara 2 50m Bebas / 31.45s" />
          </div>
        </div>

        <button type="submit" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition">
          Simpan Atlet ke Database
        </button>
      </form>

      <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-slate-800">Database Atlet & Seleksi Usia / KU (${participants.length})</h3>
            <p class="text-xs text-slate-500">Filter berdasarkan KU (Kategori Usia) atau cari nama, sekolah, dan catatan prestasi atlet.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <input type="text" id="db-search" placeholder="Cari nama / sekolah / prestasi..." class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
            <select id="db-filter-ku" class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">Semua KU</option>
              <option value="KU-5">KU-5 (≤ 9 Thn)</option>
              <option value="KU-4">KU-4 (10-11 Thn)</option>
              <option value="KU-3">KU-3 (12-13 Thn)</option>
              <option value="KU-2">KU-2 (14-15 Thn)</option>
              <option value="KU-1">KU-1 (16-18 Thn)</option>
              <option value="Senior">Senior (≥ 19 Thn)</option>
            </select>
            <button type="button" id="btn-export-db-atlet" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white">
              Export CSV Seleksi
            </button>
          </div>
        </div>

        <div id="db-table-wrap" class="overflow-x-auto"></div>
      </div>
    </div>
  `;

  // Otomatis set dropdown KU saat tanggal lahir dipilih
  const dobInput = container.querySelector("#pst-dob");
  const kuSelectForm = container.querySelector("#pst-ku");
  dobInput?.addEventListener("change", () => {
    const { ku } = calculateAgeAndKU(dobInput.value);
    if (ku && kuSelectForm) {
      kuSelectForm.value = ku;
    }
  });

  container.querySelector("#form-add-participant")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const namaLengkap = container.querySelector("#pst-name").value.trim();
    const tanggalLahir = container.querySelector("#pst-dob").value;
    const rawKu = container.querySelector("#pst-ku").value;
    const asalSekolah = container.querySelector("#pst-school").value.trim();
    const jenisKelamin = container.querySelector("#pst-gender").value;
    const classId = container.querySelector("#pst-class").value;
    const nomorInduk = container.querySelector("#pst-nis").value.trim();
    const namaOrangTua = container.querySelector("#pst-parent").value.trim();
    const noWaDarurat = container.querySelector("#pst-wa").value.trim();
    const statusPembayaran = container.querySelector("#pst-payment").value;
    const catatanPrestasi = container.querySelector("#pst-achievement").value.trim();

    if (!namaLengkap || !tanggalLahir) {
      showToast("Nama lengkap dan tanggal lahir atlet wajib diisi.", "warning");
      return;
    }

    const { ku: calculatedKu } = calculateAgeAndKU(tanggalLahir);
    const kelompokUmur = rawKu === "AUTO" || !rawKu ? calculatedKu : rawKu;
    const pstId = `pst_${slugifyId(namaLengkap) || "atlet"}_${Date.now().toString().slice(-4)}`;

    try {
      await setDoc(doc(db, "participants", pstId), {
        nomor_induk: nomorInduk,
        nama_lengkap: namaLengkap,
        nama_panggilan: namaLengkap.split(" ")[0],
        tanggal_lahir: tanggalLahir,
        kelompok_umur: kelompokUmur,
        asal_sekolah: asalSekolah,
        jenis_kelamin: jenisKelamin,
        kategori: "atlet",
        class_id: classId,
        nama_orang_tua: namaOrangTua,
        no_wa_darurat: noWaDarurat,
        status_pembayaran: statusPembayaran,
        catatan_prestasi: catatanPrestasi,
        status_keanggotaan: "aktif",
        tanggal_gabung: getTodayISO(),
        created_by: user.uid,
        created_at: new Date().toISOString()
      });

      showToast(`Atlet ${namaLengkap} (${kelompokUmur}) berhasil ditambahkan.`, "success");
      const nextState = await fetchClubState();
      await renderDatabaseAtlet(container, nextState, user);
    } catch (err) {
      console.error(err);
      showToast("Gagal menambahkan atlet ke database.", "error");
    }
  });

  const wrap = container.querySelector("#db-table-wrap");
  const searchInput = container.querySelector("#db-search");
  const kuFilterSelect = container.querySelector("#db-filter-ku");
  let currentFilteredAtlet = [];

  function drawTable() {
    const keyword = (searchInput.value || "").toLowerCase().trim();
    const kuFilter = kuFilterSelect.value;

    const filtered = participants.filter((p) => {
      const effectiveKu = p.kelompok_umur || calculateAgeAndKU(p.tanggal_lahir).ku;
      const matchKu = !kuFilter || effectiveKu === kuFilter;
      const matchSearch =
        !keyword ||
        (p.nama_lengkap || "").toLowerCase().includes(keyword) ||
        (p.asal_sekolah || "").toLowerCase().includes(keyword) ||
        (p.nomor_induk || "").toLowerCase().includes(keyword) ||
        (p.catatan_prestasi || "").toLowerCase().includes(keyword);
      return matchKu && matchSearch;
    });

    currentFilteredAtlet = filtered;

    if (filtered.length === 0) {
      wrap.innerHTML = `<p class="text-sm text-slate-500 py-4">Tidak ada data atlet yang cocok dengan filter.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3">Atlet & No. Induk</th>
            <th class="py-2.5 px-3">Tgl Lahir & KU</th>
            <th class="py-2.5 px-3">Asal Sekolah</th>
            <th class="py-2.5 px-3">Kelas</th>
            <th class="py-2.5 px-3">Pembayaran</th>
            <th class="py-2.5 px-3">Catatan Prestasi</th>
            <th class="py-2.5 px-3">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${filtered
            .map((p) => {
              const { age, ku: autoKu } = calculateAgeAndKU(p.tanggal_lahir);
              const effectiveKu = p.kelompok_umur || autoKu || "KU-4";
              return `
                <tr data-pst-row="${p.id}">
                  <td class="py-2.5 px-3">
                    <div class="font-semibold text-slate-800">${escapeHtml(p.nama_lengkap)} <span class="text-xs font-normal text-slate-400">(${escapeHtml(p.jenis_kelamin || "-")})</span></div>
                    <div class="text-xs text-slate-500">${escapeHtml(p.nomor_induk || "-")}</div>
                  </td>
                  <td class="py-2.5 px-3 space-y-1">
                    <input type="date" class="pst-dob px-2 py-1 border border-slate-300 rounded text-xs" value="${escapeHtml(p.tanggal_lahir || "")}" />
                    <div class="flex items-center gap-1.5">
                      <select class="pst-ku px-2 py-0.5 border border-slate-300 rounded text-xs font-bold bg-sky-50 text-sky-800">
                        <option value="KU-5" ${effectiveKu === "KU-5" ? "selected" : ""}>KU-5</option>
                        <option value="KU-4" ${effectiveKu === "KU-4" ? "selected" : ""}>KU-4</option>
                        <option value="KU-3" ${effectiveKu === "KU-3" ? "selected" : ""}>KU-3</option>
                        <option value="KU-2" ${effectiveKu === "KU-2" ? "selected" : ""}>KU-2</option>
                        <option value="KU-1" ${effectiveKu === "KU-1" ? "selected" : ""}>KU-1</option>
                        <option value="Senior" ${effectiveKu === "Senior" ? "selected" : ""}>Senior</option>
                      </select>
                      ${age !== null ? `<span class="text-[11px] text-slate-500">(${age} th)</span>` : ""}
                    </div>
                  </td>
                  <td class="py-2.5 px-3">
                    <input type="text" class="pst-school w-36 px-2 py-1 border border-slate-300 rounded text-xs" value="${escapeHtml(p.asal_sekolah || "")}" placeholder="Asal sekolah..." />
                  </td>
                  <td class="py-2.5 px-3">
                    <select class="pst-cls px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                      <option value="">-- Tanpa Kelas --</option>
                      ${classes
                        .map(
                          (c) =>
                            `<option value="${c.id}" ${p.class_id === c.id ? "selected" : ""}>${escapeHtml(c.nama_kelas)}</option>`
                        )
                        .join("")}
                    </select>
                  </td>
                  <td class="py-2.5 px-3">
                    <select class="pst-pay px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                      <option value="Lunas" ${p.status_pembayaran === "Lunas" ? "selected" : ""}>Lunas</option>
                      <option value="Belum Lunas" ${p.status_pembayaran === "Belum Lunas" ? "selected" : ""}>Belum Lunas</option>
                      <option value="Beasiswa / Khusus" ${p.status_pembayaran === "Beasiswa / Khusus" ? "selected" : ""}>Beasiswa / Khusus</option>
                    </select>
                  </td>
                  <td class="py-2.5 px-3">
                    <input type="text" class="pst-ach w-40 px-2 py-1 border border-slate-300 rounded text-xs" value="${escapeHtml(p.catatan_prestasi || "")}" placeholder="Catatan prestasi..." />
                  </td>
                  <td class="py-2.5 px-3">
                    <button type="button" data-action="update-pst" data-id="${p.id}" class="px-3 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
                      Simpan
                    </button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  searchInput?.addEventListener("input", drawTable);
  kuFilterSelect?.addEventListener("change", drawTable);

  container.querySelector("#btn-export-db-atlet")?.addEventListener("click", () => {
    const csvRows = [
      ["No. Induk", "Nama Atlet", "L/P", "Tanggal Lahir", "Usia (Thn)", "KU", "Asal Sekolah", "Kelas", "Status Pembayaran", "Catatan Prestasi"],
      ...currentFilteredAtlet.map((p) => {
        const { age, ku: autoKu } = calculateAgeAndKU(p.tanggal_lahir);
        return [
          p.nomor_induk || "",
          p.nama_lengkap || "",
          p.jenis_kelamin || "",
          p.tanggal_lahir || "",
          age !== null ? age : "",
          p.kelompok_umur || autoKu || "",
          p.asal_sekolah || "",
          state.classMap[p.class_id]?.nama_kelas || "",
          p.status_pembayaran || "",
          p.catatan_prestasi || ""
        ];
      })
    ];
    downloadCsv(`database-seleksi-atlet-${kuFilterSelect.value || "semua-ku"}.csv`, csvRows);
  });

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest('button[data-action="update-pst"]');
    if (!btn) return;
    const pstId = btn.dataset.id;
    const row = container.querySelector(`tr[data-pst-row="${pstId}"]`);
    const tanggalLahir = row.querySelector(".pst-dob").value;
    const kelompokUmur = row.querySelector(".pst-ku").value;
    const asalSekolah = row.querySelector(".pst-school").value.trim();
    const classId = row.querySelector(".pst-cls").value;
    const statusPembayaran = row.querySelector(".pst-pay").value;
    const catatanPrestasi = row.querySelector(".pst-ach").value.trim();

    if (!tanggalLahir) {
      showToast("Tanggal lahir atlet wajib diisi.", "warning");
      return;
    }

    try {
      await updateDoc(doc(db, "participants", pstId), {
        kategori: "atlet",
        tanggal_lahir: tanggalLahir,
        kelompok_umur: kelompokUmur,
        asal_sekolah: asalSekolah,
        class_id: classId,
        status_pembayaran: statusPembayaran,
        catatan_prestasi: catatanPrestasi,
        updated_by: user.uid,
        updated_at: new Date().toISOString()
      });
      showToast("Data atlet berhasil diperbarui.", "success");
      const nextState = await fetchClubState();
      await renderDatabaseAtlet(container, nextState, user);
    } catch (err) {
      console.error(err);
      showToast("Gagal memperbarui data atlet.", "error");
    }
  });

  drawTable();
}

// ============================================================================
// ENTRY POINT RENDER VIEW
// ============================================================================
export async function renderView({ container, view, user }) {
  const state = await fetchClubState();

  switch (view) {
    case "overview":
      await renderOverview(container, state);
      break;
    case "verifikasi":
      await renderVerifikasiDanKelas(container, state, user);
      break;
    case "users":
      await renderPelatihDanRole(container, state, user);
      break;
    case "absensi_pelatih":
      await renderRekapHadirPelatih(container, state);
      break;
    case "absensi_siswa":
      await renderRekapHadirAtlet(container, state);
      break;
    case "database":
      await renderDatabaseAtlet(container, state, user);
      break;
    default:
      await renderOverview(container, state);
      break;
  }
}
