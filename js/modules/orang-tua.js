import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  arrayUnion,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getTodayISO,
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

function getQrParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    sessionId: (params.get("session") || "").trim(),
    token: (params.get("token") || "").trim()
  };
}

function clearQrParamsFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
  } catch (_) {
    // Abaikan jika browser membatasi replaceState
  }
}

function calculateAgeAndKU(dobString) {
  if (!dobString) return { age: null, ku: "" };
  const birthYear = Number(String(dobString).slice(0, 4));
  if (!birthYear || Number.isNaN(birthYear)) return { age: null, ku: "" };

  const age = Math.max(0, new Date().getFullYear() - birthYear);
  let ku = "Senior";
  if (age <= 9) ku = "KU-5";
  else if (age <= 11) ku = "KU-4";
  else if (age <= 13) ku = "KU-3";
  else if (age <= 15) ku = "KU-2";
  else if (age <= 18) ku = "KU-1";

  return { age, ku };
}

async function fetchParentState(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid));
  const freshUser = userSnap.exists() ? { uid: user.uid, ...userSnap.data() } : user;

  let allClasses = [];
  try {
    const classesSnap = await getDocs(collection(db, "classes"));
    allClasses = classesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (clsErr) {
    console.warn("Gagal memuat daftar kelas:", clsErr?.code || clsErr);
  }
  const classMap = Object.fromEntries(allClasses.map((c) => [c.id, c]));

  // Ambil hanya dokumen atlet milik orang tua ini (hindari getDocs seluruh koleksi participants)
  const childMap = new Map();

  try {
    const byParentSnap = await getDocs(
      query(collection(db, "participants"), where("parent_uid", "==", freshUser.uid))
    );
    byParentSnap.docs.forEach((d) => {
      childMap.set(d.id, { id: d.id, ...d.data() });
    });
  } catch (qErr) {
    console.warn("Query parent_uid participants:", qErr?.code || qErr);
  }

  const linkedIds = Array.isArray(freshUser.linked_participants)
    ? freshUser.linked_participants
    : [];

  for (const pid of linkedIds) {
    if (pid && !childMap.has(pid)) {
      try {
        const pSnap = await getDoc(doc(db, "participants", pid));
        if (pSnap.exists()) {
          childMap.set(pSnap.id, { id: pSnap.id, ...pSnap.data() });
        }
      } catch (_) {
        // Lewati jika dokumen tidak ditemukan atau belum diizinkan
      }
    }
  }

  const children = Array.from(childMap.values());
  return { freshUser, allClasses, classMap, children };
}

// ============================================================================
// 1. PROFIL ATLET ANAK & ABSENSI (PIN / QR UNTUK HADIR, SERTA IZIN / SAKIT)
// ============================================================================
async function renderAbsensiAnak(container, state) {
  const { freshUser, classMap, children } = state;
  const todayStr = getTodayISO();
  const qrParams = getQrParamsFromUrl();

  const childIds = children.map((c) => c.id);
  const childAttMap = {};

  if (childIds.length > 0) {
    try {
      const attSnap = await getDocs(
        query(collection(db, "attendances"), where("tanggal", "==", todayStr))
      );
      attSnap.docs.forEach((d) => {
        const data = d.data();
        if (childIds.includes(data.participant_id)) {
          childAttMap[data.participant_id] = { id: d.id, ...data };
        }
      });
    } catch (attErr) {
      console.warn("Gagal memuat absensi hari ini:", attErr?.code || attErr);
    }
  }

  container.innerHTML = `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 class="text-xl font-bold text-slate-800">Profil Atlet & Absensi Kehadiran</h2>
          <p class="text-xs text-slate-500 mt-0.5">
            Tanggal: <strong>${formatTanggalIndo(todayStr)}</strong> · Kehadiran <strong>Hadir</strong> memakai PIN 4 digit / QR Code sesi kolam; <strong>Izin / Sakit</strong> dapat diajukan langsung.
          </p>
        </div>
      </div>

      ${
        qrParams.sessionId
          ? `
        <div class="bg-sky-50 border border-sky-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="text-xs text-sky-900">
            <p class="font-bold text-sm">QR Code Sesi Terdeteksi</p>
            <p class="mt-0.5">Sesi: <code class="bg-white px-1.5 py-0.5 rounded border border-sky-200">${escapeHtml(qrParams.sessionId)}</code> · Pilih atlet lalu klik <strong>Check-in Hadir</strong> untuk menyelesaikan absensi.</p>
          </div>
          <button type="button" id="btn-clear-qr" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-sky-800 border border-sky-200 hover:bg-sky-100 w-fit">
            Bersihkan Parameter QR
          </button>
        </div>
      `
          : ""
      }

      ${
        children.length === 0
          ? `
        <div class="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
          <p class="text-sm font-semibold text-slate-700">Belum ada data atlet tertaut ke akun ini.</p>
          <p class="text-xs text-slate-500">Gunakan tab <strong>Daftar Atlet</strong> untuk menambahkan data atlet ke akun orang tua Anda.</p>
        </div>
      `
          : `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          ${children
            .map((child) => {
              const cls = classMap[child.class_id];
              const todayAtt = childAttMap[child.id];
              const isPending = child.status_keanggotaan === "pending_verifikasi";
              const isActiveMember = child.status_keanggotaan === "aktif";
              const kuLabel = child.kelompok_umur || calculateAgeAndKU(child.tanggal_lahir).ku || "-";

              return `
                <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xs" data-child-card="${child.id}">
                  <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(child.nama_lengkap)}</h3>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-sky-100 text-sky-800">
                          ATLET · ${escapeHtml(kuLabel)}
                        </span>
                      </div>
                      <p class="text-xs text-slate-500 mt-1">
                        No. Induk: <strong>${escapeHtml(child.nomor_induk || "Menunggu")}</strong> · Kelas: <strong>${escapeHtml(cls?.nama_kelas || "Belum ditempatkan")}</strong>
                      </p>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(child.status_keanggotaan || "pending_verifikasi")}">
                      ${escapeHtml(child.status_keanggotaan || "pending_verifikasi")}
                    </span>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                    <div><span class="text-slate-400">Tgl Lahir:</span> <strong class="text-slate-700">${escapeHtml(child.tanggal_lahir || "-")}</strong></div>
                    <div><span class="text-slate-400">Asal Sekolah:</span> <strong class="text-slate-700">${escapeHtml(child.asal_sekolah || "-")}</strong></div>
                    <div class="col-span-2"><span class="text-slate-400">Jadwal Kelas:</span> <strong class="text-slate-700">${escapeHtml(cls?.jadwal_teks || "Mengikuti info pelatih")}</strong></div>
                    <div class="col-span-2"><span class="text-slate-400">Catatan Medis:</span> <strong class="text-slate-700">${escapeHtml(child.catatan_medis || "-")}</strong></div>
                  </div>

                  <!-- Status Kehadiran Hari Ini -->
                  <div class="border border-slate-200 rounded-xl p-3.5 space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-slate-700 uppercase">Absensi Hari Ini</span>
                      ${
                        todayAtt
                          ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(todayAtt.status_kehadiran)}">${escapeHtml(todayAtt.status_kehadiran)}</span>`
                          : `<span class="text-xs text-slate-400">Belum tercatat</span>`
                      }
                    </div>

                    ${
                      todayAtt
                        ? `
                      <div class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg">
                        <div>Keterangan: <strong>${escapeHtml(todayAtt.keterangan_ortu || "-")}</strong></div>
                        <div class="text-[11px] text-slate-400 mt-0.5">
                          ${todayAtt.diverifikasi_pelatih ? "✓ Sudah diverifikasi pelatih" : "Menunggu validasi pelatih"}
                        </div>
                      </div>
                    `
                        : ""
                    }

                    ${
                      isPending
                        ? `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg">Data atlet masih menunggu verifikasi & penempatan kelas oleh Admin/Pelatih.</p>`
                        : !isActiveMember || !child.class_id
                        ? `<p class="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg">Atlet belum berstatus aktif atau belum memiliki kelas latihan.</p>`
                        : `
                      <!-- Form Check-in Hadir dengan PIN / QR -->
                      <div class="space-y-2 pt-1">
                        <label class="block text-xs font-semibold text-slate-600">PIN Sesi 4 Digit di Kolam (untuk Hadir)</label>
                        <div class="flex gap-2">
                          <input
                            type="text"
                            maxlength="6"
                            inputmode="numeric"
                            value="${escapeHtml(qrParams.token && qrParams.sessionId ? "QR_TOKEN" : "")}"
                            placeholder="Masukkan PIN 4 digit"
                            class="att-pin flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-widest font-bold"
                          />
                          <button
                            type="button"
                            data-action="checkin-hadir"
                            data-child-id="${child.id}"
                            class="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                          >
                            Check-in Hadir
                          </button>
                        </div>
                      </div>

                      <!-- Form Ajukan Izin / Sakit -->
                      <div class="space-y-2 pt-2 border-t border-slate-100">
                        <label class="block text-xs font-semibold text-slate-600">Tidak Bisa Hadir? Ajukan Izin / Sakit</label>
                        <div class="flex flex-col sm:flex-row gap-2">
                          <select class="att-excuse-type px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white">
                            <option value="izin">Izin</option>
                            <option value="sakit">Sakit</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Alasan singkat (misal: demam / acara keluarga)"
                            class="att-excuse-note flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                          />
                          <button
                            type="button"
                            data-action="submit-excuse"
                            data-child-id="${child.id}"
                            class="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 whitespace-nowrap"
                          >
                            Kirim Izin/Sakit
                          </button>
                        </div>
                      </div>
                    `
                    }
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      }
    </div>
  `;

  container.querySelector("#btn-clear-qr")?.addEventListener("click", async () => {
    clearQrParamsFromUrl();
    const nextState = await fetchParentState(freshUser);
    await renderAbsensiAnak(container, nextState);
  });

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const childId = btn.dataset.childId;
    const child = children.find((c) => c.id === childId);
    const card = container.querySelector(`[data-child-card="${childId}"]`);

    if (!child || !child.class_id) return;

    if (action === "checkin-hadir") {
      const pinInputEl = card.querySelector(".att-pin");
      const rawInput = (pinInputEl?.value || "").trim();
      const currentQr = getQrParamsFromUrl();
      const usingQrToken = Boolean(currentQr.sessionId && currentQr.token && rawInput === "QR_TOKEN");

      if (!rawInput) {
        showToast("Masukkan PIN 4 digit sesi atau pindai QR Code di kolam.", "warning");
        return;
      }

      try {
        const sessionsSnap = await getDocs(
          query(
            collection(db, "attendance_sessions"),
            where("class_id", "==", child.class_id),
            where("tanggal", "==", todayStr),
            where("status_sesi", "==", "aktif")
          )
        );

        const activeSessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const nowMs = Date.now();

        const validSession = activeSessions.find((s) => {
          const notExpired = !s.expires_at || nowMs <= new Date(s.expires_at).getTime();
          if (!notExpired) return false;
          if (usingQrToken) {
            return s.id === currentQr.sessionId && s.session_token === currentQr.token;
          }
          return String(s.pin_code || "").trim() === rawInput;
        });

        if (!validSession) {
          showToast("PIN salah, sesi belum dibuka, atau sesi absensi sudah kedaluwarsa.", "error");
          return;
        }

        const attDocId = `${todayStr}_${child.class_id}_${child.id}`;
        await setDoc(doc(db, "attendances", attDocId), {
          tanggal: todayStr,
          class_id: child.class_id,
          session_id: validSession.id,
          participant_id: child.id,
          nama_peserta: child.nama_lengkap,
          kategori: "atlet",
          status_kehadiran: "hadir",
          metode_validasi: usingQrToken ? "qr_sesi" : "pin_sesi",
          keterangan_ortu: usingQrToken ? "Check-in QR di kolam" : "Check-in PIN di kolam",
          waktu_input_ortu: new Date().toISOString(),
          diinput_oleh_uid: freshUser.uid,
          diverifikasi_pelatih: false
        });

        showToast(`Check-in HADIR tercatat untuk ${child.nama_lengkap}!`, "success");
        const nextState = await fetchParentState(freshUser);
        await renderAbsensiAnak(container, nextState);
      } catch (err) {
        console.error(err);
        showToast("Gagal melakukan check-in kehadiran.", "error");
      }
    }

    if (action === "submit-excuse") {
      const excuseType = card.querySelector(".att-excuse-type")?.value || "izin";
      const excuseNote = (card.querySelector(".att-excuse-note")?.value || "").trim();

      if (!excuseNote) {
        showToast("Tuliskan alasan izin atau sakit terlebih dahulu.", "warning");
        return;
      }

      try {
        const attDocId = `${todayStr}_${child.class_id}_${child.id}`;
        await setDoc(doc(db, "attendances", attDocId), {
          tanggal: todayStr,
          class_id: child.class_id,
          participant_id: child.id,
          nama_peserta: child.nama_lengkap,
          kategori: "atlet",
          status_kehadiran: excuseType,
          metode_validasi: "input_orang_tua",
          keterangan_ortu: excuseNote,
          waktu_input_ortu: new Date().toISOString(),
          diinput_oleh_uid: freshUser.uid,
          diverifikasi_pelatih: false
        });

        showToast(`Pengajuan ${excuseType.toUpperCase()} untuk ${child.nama_lengkap} terkirim.`, "success");
        const nextState = await fetchParentState(freshUser);
        await renderAbsensiAnak(container, nextState);
      } catch (err) {
        console.error(err);
        showToast("Gagal mengirim pengajuan izin/sakit.", "error");
      }
    }
  });
}

// ============================================================================
// 2. JADWAL & PROGRAM LATIHAN ATLET
// ============================================================================
async function renderJadwalDanProgram(container, state) {
  const { classMap, children } = state;
  const activeClassIds = new Set(children.map((c) => c.class_id).filter(Boolean));

  let visiblePrograms = [];
  if (activeClassIds.size > 0) {
    try {
      const prgSnap = await getDocs(collection(db, "training_programs"));
      visiblePrograms = prgSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.tampilkan_ke_orangtua === true && activeClassIds.has(p.class_id))
        .sort((a, b) => String(b.tanggal_latihan || "").localeCompare(String(a.tanggal_latihan || "")));
    } catch (prgErr) {
      console.warn("Gagal memuat program latihan:", prgErr?.code || prgErr);
    }
  }

  container.innerHTML = `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 class="text-lg font-bold text-slate-800">Jadwal Kelas & Ringkasan Program Latihan</h2>
        <p class="text-xs text-slate-500 mt-0.5">Program latihan yang dibagikan pelatih untuk kelas atlet Anda.</p>

        ${
          children.length === 0
            ? `<p class="text-sm text-slate-500 mt-4">Belum ada atlet terdaftar pada akun ini.</p>`
            : `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            ${children
              .map((ch) => {
                const cls = classMap[ch.class_id];
                return `
                  <div class="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70">
                    <div class="font-bold text-slate-800">${escapeHtml(ch.nama_lengkap)} <span class="text-xs uppercase text-sky-700">(ATLET)</span></div>
                    <div class="text-xs text-slate-600 mt-1">Kelas: <strong>${escapeHtml(cls?.nama_kelas || "Belum ditempatkan")}</strong></div>
                    <div class="text-xs text-slate-500 mt-0.5">Jadwal: ${escapeHtml(cls?.jadwal_teks || "Menunggu jadwal kelas")}</div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `
        }
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h3 class="font-bold text-slate-800">Program Latihan Terbaru</h3>
        ${
          visiblePrograms.length === 0
            ? `<p class="text-sm text-slate-500">Belum ada program latihan yang dibagikan pelatih untuk kelas atlet Anda.</p>`
            : `
          <div class="space-y-3">
            ${visiblePrograms
              .map(
                (p) => `
              <div class="border border-slate-200 rounded-xl p-4 space-y-1.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs font-bold text-sky-800">${escapeHtml(classMap[p.class_id]?.nama_kelas || p.class_id)}</span>
                  <span class="text-xs text-slate-500">${escapeHtml(formatTanggalIndo(p.tanggal_latihan))} · Volume: <strong>${escapeHtml(String(p.total_volume_meter || 0))}m</strong></span>
                </div>
                <h4 class="font-bold text-slate-800">${escapeHtml(p.judul_sesi || "Sesi Latihan")}</h4>
                ${
                  p.detail_program?.warm_up
                    ? `<p class="text-xs text-slate-600"><strong>Warm Up:</strong> ${escapeHtml(p.detail_program.warm_up)}</p>`
                    : ""
                }
                ${
                  p.detail_program?.main_set
                    ? `<p class="text-xs text-slate-600 whitespace-pre-line"><strong>Main Set:</strong> ${escapeHtml(p.detail_program.main_set)}</p>`
                    : ""
                }
                ${
                  p.detail_program?.cool_down
                    ? `<p class="text-xs text-slate-600"><strong>Cool Down:</strong> ${escapeHtml(p.detail_program.cool_down)}</p>`
                    : ""
                }
                ${
                  p.catatan_evaluasi_pelatih
                    ? `<p class="text-xs text-sky-800 bg-sky-50 p-2 rounded-lg mt-1"><strong>Catatan Pelatih:</strong> ${escapeHtml(p.catatan_evaluasi_pelatih)}</p>`
                    : ""
                }
              </div>
            `
              )
              .join("")}
          </div>
        `
        }
      </div>
    </div>
  `;
}

// ============================================================================
// 3. PENDAFTARAN ATLET TAMBAHAN PADA AKUN ORANG TUA
// ============================================================================
async function renderTambahAnak(container, state) {
  const { freshUser } = state;

  container.innerHTML = `
    <div class="max-w-xl bg-white rounded-2xl border border-slate-200 p-6">
      <h2 class="text-lg font-bold text-slate-800">Daftarkan Atlet Tambahan</h2>
      <p class="text-xs text-slate-500 mt-0.5 mb-4">
        Tambahkan atlet lain ke akun orang tua <strong>${escapeHtml(freshUser.nama || freshUser.email)}</strong>. Data akan masuk ke antrean verifikasi Admin/Pelatih.
      </p>

      <form id="form-add-child" class="space-y-3.5">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Atlet</label>
          <input type="text" id="add-child-name" required class="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal Lahir</label>
            <input type="date" id="add-child-dob" required class="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Jenis Kelamin</label>
            <select id="add-child-gender" class="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="L">Putra (L)</option>
              <option value="P">Putri (P)</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Asal Sekolah</label>
          <input type="text" id="add-child-school" required class="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Nama sekolah atlet" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Catatan Medis / Alergi (Opsional)</label>
          <input type="text" id="add-child-medical" class="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Tidak ada / asma ringan" />
        </div>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg text-sm transition">
          Kirim Pendaftaran Atlet
        </button>
      </form>
    </div>
  `;

  container.querySelector("#form-add-child")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const childName = container.querySelector("#add-child-name").value.trim();
    const childDob = container.querySelector("#add-child-dob").value;
    const childGender = container.querySelector("#add-child-gender").value;
    const schoolName = container.querySelector("#add-child-school").value.trim();
    const medical = container.querySelector("#add-child-medical").value.trim() || "Tidak ada catatan khusus";

    if (!childName || !childDob) return;

    const { ku: kelompokUmur } = calculateAgeAndKU(childDob);
    const participantId = `pst_${freshUser.uid.slice(0, 8)}_${Date.now().toString().slice(-5)}`;

    try {
      await setDoc(doc(db, "participants", participantId), {
        nomor_induk: "",
        nama_lengkap: childName,
        nama_panggilan: childName.split(" ")[0],
        tanggal_lahir: childDob,
        jenis_kelamin: childGender,
        kelompok_umur: kelompokUmur,
        asal_sekolah: schoolName,
        kategori: "atlet",
        class_id: "",
        parent_uid: freshUser.uid,
        nama_orang_tua: freshUser.nama || "",
        no_wa_darurat: freshUser.no_wa || "",
        catatan_medis: medical,
        catatan_best_time: {},
        status_keanggotaan: "pending_verifikasi",
        tanggal_gabung: getTodayISO()
      });

      await updateDoc(doc(db, "users", freshUser.uid), {
        linked_participants: arrayUnion(participantId)
      });

      showToast(`Pendaftaran atlet ${childName} berhasil dikirim! Menunggu verifikasi admin.`, "success");
      const nextState = await fetchParentState(freshUser);
      await renderAbsensiAnak(container, nextState);
    } catch (err) {
      console.error(err);
      showToast("Gagal menambahkan data atlet.", "error");
    }
  });
}

// ============================================================================
// ENTRY POINT RENDER VIEW (DIPANGGIL OLEH ROUTER)
// ============================================================================
export async function renderView({ container, view, user }) {
  const state = await fetchParentState(user);

  switch (view) {
    case "absensi":
      await renderAbsensiAnak(container, state);
      break;
    case "program_info":
      await renderJadwalDanProgram(container, state);
      break;
    case "tambah_anak":
      await renderTambahAnak(container, state);
      break;
    default:
      await renderAbsensiAnak(container, state);
      break;
  }
}
