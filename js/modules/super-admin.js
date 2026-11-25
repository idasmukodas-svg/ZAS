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
  where,
  orderBy
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
  const activeAtlet = participants.filter((p) => p.kategori === "atlet" && p.status_keanggotaan === "aktif").length;
  const activeSiswa = participants.filter((p) => p.kategori === "siswa" && p.status_keanggotaan === "aktif").length;
  const pendingCount = participants.filter((p) => p.status_keanggotaan === "pending_verifikasi").length;
  const coachCount = users.filter((u) => ["pelatih", "admin_pelatih"].includes(u.role)).length;

  const todayStr = getTodayISO();
  const attSnap = await getDocs(query(collection(db, "attendances"), where("tanggal", "==", todayStr)));
  const todayAtt = attSnap.docs.map((d) => d.data());
  const hadirAtletHariIni = todayAtt.filter((a) => a.kategori === "atlet" && a.status_kehadiran === "hadir").length;
  const hadirSiswaHariIni = todayAtt.filter((a) => a.kategori === "siswa" && a.status_kehadiran === "hadir").length;

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 class="text-xl font-bold text-slate-800">Ringkasan Operasional Klub</h2>
          <p class="text-sm text-slate-500">Tanggal acuan: ${formatTanggalIndo(todayStr)}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Atlet Aktif</p>
          <p class="text-2xl font-bold text-sky-700 mt-1">${activeAtlet}</p>
          <p class="text-xs text-emerald-700 mt-1">Hadir hari ini: ${hadirAtletHariIni}</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Siswa Aktif</p>
          <p class="text-2xl font-bold text-indigo-700 mt-1">${activeSiswa}</p>
          <p class="text-xs text-emerald-700 mt-1">Hadir hari ini: ${hadirSiswaHariIni}</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Menunggu Verifikasi</p>
          <p class="text-2xl font-bold text-amber-600 mt-1">${pendingCount}</p>
          <p class="text-xs text-slate-500 mt-1">Pendaftar baru perlu penempatan kelas</p>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase">Kelas & Pelatih</p>
          <p class="text-2xl font-bold text-slate-800 mt-1">${classes.length} <span class="text-sm font-normal text-slate-500">kelas</span></p>
          <p class="text-xs text-slate-500 mt-1">${coachCount} akun pelatih / admin-pelatih</p>
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
                  <th class="py-2.5 px-3">Jenis</th>
                  <th class="py-2.5 px-3">Pelatih</th>
                  <th class="py-2.5 px-3">Peserta</th>
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
                        <td class="py-2.5 px-3 uppercase text-xs font-semibold text-slate-600">${escapeHtml(cls.jenis_kelas || "-")}</td>
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
// 2. VERIFIKASI PENDAFTAR, PENGKELASAN ATLET/SISWA & MANAJEMEN KELAS
// ============================================================================
async function renderVerifikasiDanKelas(container, state, user) {
  const { users, classes, participants, classMap } = state;
  const pendingList = participants.filter((p) => p.status_keanggotaan === "pending_verifikasi");
  const pelatihUsers = users.filter((u) => ["pelatih", "admin_pelatih", "super_admin"].includes(u.role));

  container.innerHTML = `
    <div class="space-y-8">
      <!-- Antrean Verifikasi Pendaftar Baru -->
      <div class="bg-white rounded-2xl border border-slate-200 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-bold text-slate-800">Verifikasi Pendaftar & Pengkelasan</h2>
            <p class="text-xs text-slate-500">Tetapkan kategori tegas (Atlet atau Siswa), nomor induk, dan kelas latihan.</p>
          </div>
          <span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            ${pendingList.length} Pending
          </span>
        </div>

        ${
          pendingList.length === 0
            ? `<p class="text-sm text-slate-500 py-4">Tidak ada pendaftar baru yang menunggu verifikasi saat ini.</p>`
            : `
          <div class="space-y-4">
            ${pendingList
              .map(
                (pst) => `
              <div class="border border-slate-200 rounded-xl p-4 bg-slate-50/60" data-verify-card="${pst.id}">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-3 border-b border-slate-200">
                  <div>
                    <h3 class="font-bold text-slate-800">${escapeHtml(pst.nama_lengkap)} <span class="text-xs font-normal text-slate-500">(${escapeHtml(pst.jenis_kelamin || "-")}, Lahir: ${escapeHtml(pst.tanggal_lahir || "-")})</span></h3>
                    <p class="text-xs text-slate-600 mt-0.5">Orang Tua: <strong>${escapeHtml(pst.nama_orang_tua || "-")}</strong> · WA: ${escapeHtml(pst.no_wa_darurat || "-")} · Medis: ${escapeHtml(pst.catatan_medis || "-")}</p>
                  </div>
                  <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 w-fit">Pilihan awal: ${escapeHtml(pst.kategori || "siswa")}</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Kategori Final</label>
                    <select class="ver-kategori w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="siswa" ${pst.kategori === "siswa" ? "selected" : ""}>Siswa</option>
                      <option value="atlet" ${pst.kategori === "atlet" ? "selected" : ""}>Atlet</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas Latihan</label>
                    <select class="ver-kelas w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">-- Pilih Kelas --</option>
                      ${classes
                        .map(
                          (c) =>
                            `<option value="${c.id}" ${pst.class_id === c.id ? "selected" : ""}>${escapeHtml(c.nama_kelas)} (${escapeHtml(c.jenis_kelas || "")})</option>`
                        )
                        .join("")}
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Kelompok Umur / Level</label>
                    <input type="text" class="ver-ku w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" value="${escapeHtml(pst.kelompok_umur || "")}" placeholder="Contoh: KU-4 / Pemula" />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">No. Induk Anggota</label>
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
            `
              )
              .join("")}
          </div>`
        }
      </div>

      <!-- Manajemen Kelas & Penugasan Pelatih -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form id="form-create-class" class="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 h-fit">
          <h3 class="text-base font-bold text-slate-800">Buat Kelas Baru</h3>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Kelas</label>
            <input type="text" id="cls-name" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Prestasi A - Pagi / Pemula Sore" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Jenis Kelas</label>
              <select id="cls-type" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="atlet">Atlet</option>
                <option value="siswa">Siswa</option>
                <option value="campuran">Campuran</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Kapasitas Maks</label>
              <input type="number" id="cls-cap" min="1" value="20" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Jadwal Ringkas</label>
            <input type="text" id="cls-schedule" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Senin, Rabu, Sabtu (05:30 - 07:30)" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Pelatih Penanggung Jawab</label>
            <select id="cls-coach" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
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
                        <div>
                          <span class="font-bold text-slate-800">${escapeHtml(cls.nama_kelas)}</span>
                          <span class="ml-2 text-xs font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">${escapeHtml(cls.jenis_kelas || "-")}</span>
                        </div>
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

  // Handler Buat Kelas Baru
  const formCreateClass = container.querySelector("#form-create-class");
  formCreateClass?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const namaKelas = container.querySelector("#cls-name").value.trim();
    const jenisKelas = container.querySelector("#cls-type").value;
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
        jenis_kelas: jenisKelas,
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

  // Delegasi Aksi Verifikasi & Penugasan Pelatih
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "approve-pst") {
      const pstId = btn.dataset.id;
      const card = container.querySelector(`[data-verify-card="${pstId}"]`);
      const kategori = card.querySelector(".ver-kategori").value;
      const classId = card.querySelector(".ver-kelas").value;
      const kelompokUmur = card.querySelector(".ver-ku").value.trim();
      const nomorInduk = card.querySelector(".ver-nis").value.trim() || `CLB-${new Date().getFullYear()}-${pstId.slice(-4).toUpperCase()}`;

      if (!classId) {
        showToast("Pilih kelas latihan terlebih dahulu sebelum menyetujui.", "warning");
        return;
      }

      try {
        await updateDoc(doc(db, "participants", pstId), {
          kategori,
          class_id: classId,
          kelompok_umur: kelompokUmur,
          nomor_induk: nomorInduk,
          status_keanggotaan: "aktif",
          verified_by: user.uid,
          verified_at: new Date().toISOString()
        });
        showToast("Peserta diverifikasi dan dimasukkan ke kelas.", "success");
        const nextState = await fetchClubState();
        await renderVerifikasiDanKelas(container, nextState, user);
      } catch (err) {
        console.error(err);
        showToast("Gagal memverifikasi peserta.", "error");
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
// 3. PENGATURAN ROLE PENGGUNA (4 ROLE)
// ============================================================================
async function renderUsersRole(container, state, currentUser) {
  const { users } = state;

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5">
      <div class="mb-4">
        <h2 class="text-lg font-bold text-slate-800">Manajemen Akun & Hak Akses (4 Role)</h2>
        <p class="text-xs text-slate-500">Atur peran akun menjadi Super Admin, Admin & Pelatih, Pelatih, atau Orang Tua.</p>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
            <tr>
              <th class="py-2.5 px-3">Nama</th>
              <th class="py-2.5 px-3">Email / WA</th>
              <th class="py-2.5 px-3">Role Saat Ini</th>
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
  `;

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
      await renderUsersRole(container, nextState, currentUser);
    } catch (err) {
      console.error(err);
      showToast("Gagal mengubah role pengguna.", "error");
    }
  });
}

// ============================================================================
// 4. REKAP DAFTAR HADIR TERPISAH (ATLET VS SISWA)
// ============================================================================
async function renderRekapTerpisah(container, state, kategoriTarget) {
  const { classes, classMap } = state;
  const labelKategori = kategoriTarget === "atlet" ? "Atlet" : "Siswa";
  const todayStr = getTodayISO();

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Daftar Hadir ${labelKategori}</h2>
          <p class="text-xs text-slate-500">Rekap khusus kategori <strong>${labelKategori}</strong> (terpisah dari ${kategoriTarget === "atlet" ? "Siswa" : "Atlet"}).</p>
        </div>
        <button type="button" id="btn-export-att" class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white w-fit">
          Export CSV ${labelKategori}
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal</label>
          <input type="date" id="filter-att-date" value="${todayStr}" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas</label>
          <select id="filter-att-class" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua Kelas</option>
            ${classes.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
          </select>
        </div>
        <div class="flex items-end">
          <button type="button" id="btn-load-att" class="w-full px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            Tampilkan Rekap
          </button>
        </div>
      </div>

      <div id="att-table-wrap" class="overflow-x-auto">
        <p class="text-sm text-slate-500 py-4">Memuat data kehadiran...</p>
      </div>
    </div>
  `;

  let latestRows = [];

  async function loadAttendanceRows() {
    const selectedDate = container.querySelector("#filter-att-date").value;
    const selectedClass = container.querySelector("#filter-att-class").value;
    const wrap = container.querySelector("#att-table-wrap");

    const constraints = [where("kategori", "==", kategoriTarget)];
    if (selectedDate) {
      constraints.push(where("tanggal", "==", selectedDate));
    }

    const q = query(collection(db, "attendances"), ...constraints);
    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (selectedClass) {
      rows = rows.filter((r) => r.class_id === selectedClass);
    }

    latestRows = rows;

    if (rows.length === 0) {
      wrap.innerHTML = `<p class="text-sm text-slate-500 py-4">Belum ada catatan kehadiran ${labelKategori.toLowerCase()} pada filter yang dipilih.</p>`;
      return;
    }

    const summary = {
      hadir: rows.filter((r) => r.status_kehadiran === "hadir").length,
      izin: rows.filter((r) => r.status_kehadiran === "izin").length,
      sakit: rows.filter((r) => r.status_kehadiran === "sakit").length,
      alpha: rows.filter((r) => r.status_kehadiran === "alpha").length
    };

    wrap.innerHTML = `
      <div class="flex flex-wrap gap-2 mb-3 text-xs font-semibold">
        <span class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Hadir: ${summary.hadir}</span>
        <span class="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800">Izin: ${summary.izin}</span>
        <span class="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">Sakit: ${summary.sakit}</span>
        <span class="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800">Alpha: ${summary.alpha}</span>
      </div>
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3">Tanggal</th>
            <th class="py-2.5 px-3">Nama ${labelKategori}</th>
            <th class="py-2.5 px-3">Kelas</th>
            <th class="py-2.5 px-3">Status</th>
            <th class="py-2.5 px-3">Keterangan Ortu</th>
            <th class="py-2.5 px-3">Verifikasi Pelatih</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows
            .map(
              (r) => `
            <tr>
              <td class="py-2.5 px-3 whitespace-nowrap">${escapeHtml(r.tanggal || "-")}</td>
              <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(r.nama_peserta || r.participant_id)}</td>
              <td class="py-2.5 px-3 text-slate-600">${escapeHtml(classMap[r.class_id]?.nama_kelas || r.class_id || "-")}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(r.status_kehadiran)}">
                  ${escapeHtml(r.status_kehadiran || "-")}
                </span>
              </td>
              <td class="py-2.5 px-3 text-slate-600">${escapeHtml(r.keterangan_ortu || "-")}</td>
              <td class="py-2.5 px-3 text-xs">${r.diverifikasi_pelatih ? "Terverifikasi" : "Menunggu"}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  container.querySelector("#btn-load-att")?.addEventListener("click", loadAttendanceRows);
  container.querySelector("#btn-export-att")?.addEventListener("click", () => {
    const csvRows = [
      ["Tanggal", "Kategori", "Nama", "Kelas", "Status", "Keterangan Orang Tua", "Terverifikasi Pelatih"],
      ...latestRows.map((r) => [
        r.tanggal || "",
        kategoriTarget,
        r.nama_peserta || r.participant_id || "",
        classMap[r.class_id]?.nama_kelas || r.class_id || "",
        r.status_kehadiran || "",
        r.keterangan_ortu || "",
        r.diverifikasi_pelatih ? "Ya" : "Tidak"
      ])
    ];
    downloadCsv(`rekap-hadir-${kategoriTarget}-${container.querySelector("#filter-att-date").value || "all"}.csv`, csvRows);
  });

  await loadAttendanceRows();
}

// ============================================================================
// 5. DATABASE ATLET & SISWA (PENGKELASAN & EDIT DATA)
// ============================================================================
async function renderDatabasePeserta(container, state, user) {
  const { participants, classes, classMap } = state;

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Database Atlet & Siswa</h2>
          <p class="text-xs text-slate-500">Kelola kategori, perpindahan kelas, dan status keanggotaan peserta klub.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <input type="text" id="db-search" placeholder="Cari nama / no. induk..." class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          <select id="db-filter-kat" class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua Kategori</option>
            <option value="atlet">Atlet</option>
            <option value="siswa">Siswa</option>
          </select>
        </div>
      </div>

      <div id="db-table-wrap" class="overflow-x-auto"></div>
    </div>
  `;

  const wrap = container.querySelector("#db-table-wrap");
  const searchInput = container.querySelector("#db-search");
  const katSelect = container.querySelector("#db-filter-kat");

  function drawTable() {
    const keyword = (searchInput.value || "").toLowerCase().trim();
    const katFilter = katSelect.value;

    const filtered = participants.filter((p) => {
      const matchKat = !katFilter || p.kategori === katFilter;
      const matchSearch =
        !keyword ||
        (p.nama_lengkap || "").toLowerCase().includes(keyword) ||
        (p.nomor_induk || "").toLowerCase().includes(keyword) ||
        (p.nama_orang_tua || "").toLowerCase().includes(keyword);
      return matchKat && matchSearch;
    });

    if (filtered.length === 0) {
      wrap.innerHTML = `<p class="text-sm text-slate-500 py-4">Tidak ada data peserta yang cocok.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3">No. Induk & Nama</th>
            <th class="py-2.5 px-3">Kategori</th>
            <th class="py-2.5 px-3">Kelas</th>
            <th class="py-2.5 px-3">Status</th>
            <th class="py-2.5 px-3">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${filtered
            .map(
              (p) => `
            <tr data-pst-row="${p.id}">
              <td class="py-2.5 px-3">
                <div class="font-semibold text-slate-800">${escapeHtml(p.nama_lengkap)}</div>
                <div class="text-xs text-slate-500">${escapeHtml(p.nomor_induk || "-")} · Ortu: ${escapeHtml(p.nama_orang_tua || "-")}</div>
              </td>
              <td class="py-2.5 px-3">
                <select class="pst-kat px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                  <option value="siswa" ${p.kategori === "siswa" ? "selected" : ""}>Siswa</option>
                  <option value="atlet" ${p.kategori === "atlet" ? "selected" : ""}>Atlet</option>
                </select>
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
                <select class="pst-status px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                  <option value="aktif" ${p.status_keanggotaan === "aktif" ? "selected" : ""}>Aktif</option>
                  <option value="pending_verifikasi" ${p.status_keanggotaan === "pending_verifikasi" ? "selected" : ""}>Pending</option>
                  <option value="cuti" ${p.status_keanggotaan === "cuti" ? "selected" : ""}>Cuti</option>
                  <option value="non_aktif" ${p.status_keanggotaan === "non_aktif" ? "selected" : ""}>Non-Aktif</option>
                </select>
              </td>
              <td class="py-2.5 px-3">
                <button type="button" data-action="update-pst" data-id="${p.id}" class="px-3 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
                  Simpan
                </button>
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  searchInput?.addEventListener("input", drawTable);
  katSelect?.addEventListener("change", drawTable);

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest('button[data-action="update-pst"]');
    if (!btn) return;
    const pstId = btn.dataset.id;
    const row = container.querySelector(`tr[data-pst-row="${pstId}"]`);
    const kategori = row.querySelector(".pst-kat").value;
    const classId = row.querySelector(".pst-cls").value;
    const statusKeanggotaan = row.querySelector(".pst-status").value;

    try {
      await updateDoc(doc(db, "participants", pstId), {
        kategori,
        class_id: classId,
        status_keanggotaan: statusKeanggotaan,
        updated_by: user.uid,
        updated_at: new Date().toISOString()
      });
      showToast("Data peserta diperbarui.", "success");
      const nextState = await fetchClubState();
      await renderDatabasePeserta(container, nextState, user);
    } catch (err) {
      console.error(err);
      showToast("Gagal memperbarui data peserta.", "error");
    }
  });

  drawTable();
}

// ============================================================================
// ENTRY POINT RENDER VIEW (DIPANGGIL OLEH ROUTER)
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
      await renderUsersRole(container, state, user);
      break;
    case "absensi_atlet":
      await renderRekapTerpisah(container, state, "atlet");
      break;
    case "absensi_siswa":
      await renderRekapTerpisah(container, state, "siswa");
      break;
    case "database":
      await renderDatabasePeserta(container, state, user);
      break;
    default:
      await renderOverview(container, state);
      break;
  }
}
