import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getTodayISO,
  generatePinCode,
  generateSessionToken,
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

function buildCheckinUrl(sessionId, token) {
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("token", token);
  return url.toString();
}

function renderQrIntoElement(element, text) {
  if (!element) return;
  element.innerHTML = "";
  if (typeof window.QRCode === "function") {
    new window.QRCode(element, {
      text,
      width: 156,
      height: 156,
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    element.innerHTML = `<div class="p-3 text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg">Library QRCode belum termuat</div>`;
  }
}

async function fetchCoachState(user) {
  const [classesSnap, participantsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "classes")),
    getDocs(collection(db, "participants")),
    getDocs(query(collection(db, "attendance_sessions"), where("tanggal", "==", getTodayISO())))
  ]);

  const allClasses = classesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const assignedIds = Array.isArray(user.assigned_classes) ? user.assigned_classes : [];

  // Super Admin / Admin Pelatih bisa melihat semua kelas jika assigned_classes kosong; Pelatih difokuskan ke kelas yang diampu
  const coachClasses =
    user.role === "super_admin" || (user.role === "admin_pelatih" && assignedIds.length === 0)
      ? allClasses
      : allClasses.filter(
          (c) => assignedIds.includes(c.id) || (Array.isArray(c.coach_uids) && c.coach_uids.includes(user.uid))
        );

  const participants = participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const todaySessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return { allClasses, coachClasses, participants, todaySessions };
}

// ============================================================================
// 1. SESI ABSENSI HARIAN (PIN 4 DIGIT + QR CODE) & VALIDASI KEHADIRAN
// ============================================================================
async function renderSesiAbsensi(container, state, user) {
  const { coachClasses, participants, todaySessions } = state;
  const todayStr = getTodayISO();

  if (coachClasses.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="text-lg font-bold text-slate-800">Sesi Absensi & PIN/QR Kolam</h2>
        <p class="text-sm text-slate-500 mt-1">Akun Anda belum ditugaskan ke kelas manapun. Hubungi Super Admin / Admin & Pelatih untuk penugasan kelas.</p>
      </div>
    `;
    return;
  }

  const defaultClassId = coachClasses[0].id;

  container.innerHTML = `
    <div class="space-y-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold text-slate-800">Sesi Absensi Harian & Validasi Kehadiran</h2>
          <p class="text-xs text-slate-500 mt-0.5">Tanggal: <strong>${formatTanggalIndo(todayStr)}</strong> · PIN 4 digit & QR Code digunakan orang tua saat check-in di kolam.</p>
        </div>
        <div class="min-w-[220px]">
          <label class="block text-xs font-semibold text-slate-600 mb-1">Pilih Kelas Aktif</label>
          <select id="coach-class-select" class="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-medium bg-white">
            ${coachClasses
              .map((c) => `<option value="${c.id}" ${c.id === defaultClassId ? "selected" : ""}>${escapeHtml(c.nama_kelas)} (${escapeHtml(c.jenis_kelas || "kelas")})</option>`)
              .join("")}
          </select>
        </div>
      </div>

      <div id="sesi-panel-content" class="grid grid-cols-1 lg:grid-cols-3 gap-6"></div>
    </div>
  `;

  const classSelect = container.querySelector("#coach-class-select");
  const panelContent = container.querySelector("#sesi-panel-content");

  async function refreshClassPanel(classId) {
    const [sessionsSnap, attSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "attendance_sessions"),
          where("class_id", "==", classId),
          where("tanggal", "==", todayStr)
        )
      ),
      getDocs(
        query(
          collection(db, "attendances"),
          where("class_id", "==", classId),
          where("tanggal", "==", todayStr)
        )
      )
    ]);

    const classSessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const activeSession =
      classSessions.find((s) => s.status_sesi === "aktif") ||
      classSessions[classSessions.length - 1] ||
      null;

    const classParticipants = participants.filter(
      (p) => p.class_id === classId && p.status_keanggotaan === "aktif"
    );
    const attMap = Object.fromEntries(
      attSnap.docs.map((d) => {
        const data = d.data();
        return [data.participant_id, { id: d.id, ...data }];
      })
    );

    const isActive = activeSession && activeSession.status_sesi === "aktif";
    const expiresDate = activeSession?.expires_at ? new Date(activeSession.expires_at) : null;
    const isExpired = expiresDate ? Date.now() > expiresDate.getTime() : false;

    panelContent.innerHTML = `
      <!-- Kolom Kiri: Kontrol PIN 4 Digit & QR Code Sesi -->
      <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 h-fit">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-slate-800">Kontrol Sesi Kolam</h3>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isActive && !isExpired
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-600"
          }">
            ${isActive && !isExpired ? "SESI AKTIF" : isActive && isExpired ? "KEDALUWARSA" : "DITUTUP"}
          </span>
        </div>

        ${
          activeSession
            ? `
          <div class="bg-sky-50 border border-sky-200 rounded-xl p-4 text-center space-y-2">
            <p class="text-xs font-semibold text-sky-800 uppercase tracking-wider">PIN Sesi 4 Digit</p>
            <div id="display-session-pin" class="text-4xl font-extrabold tracking-[0.3em] text-sky-900 select-all">
              ${escapeHtml(activeSession.pin_code || "----")}
            </div>
            <p class="text-[11px] text-slate-600">
              Berlaku s.d. ${
                expiresDate && !Number.isNaN(expiresDate.getTime())
                  ? expiresDate.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                  : "-"
              } WIB
            </p>
            <div class="flex justify-center pt-2">
              <div id="session-qr-box" class="bg-white p-2.5 rounded-xl border border-sky-100 shadow-sm"></div>
            </div>
            <p class="text-[11px] text-slate-500">Orang tua memindai QR atau mengetik PIN di akunnya saat tiba di kolam.</p>
          </div>
        `
            : `
          <div class="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center text-xs text-slate-500">
            Belum ada sesi absensi dibuka untuk kelas ini hari ini. Tekan tombol di bawah untuk membuat PIN 4 digit & QR Code.
          </div>
        `
        }

        <div class="space-y-2">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Durasi Berlaku PIN (Menit)</label>
            <input type="number" id="pin-duration-min" min="10" max="240" value="60" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>

          <button type="button" id="btn-open-session" class="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white transition">
            ${isActive ? "Putar Ulang PIN & QR Baru" : "Buka Sesi Absensi (PIN & QR)"}
          </button>

          ${
            activeSession && isActive
              ? `
            <button type="button" id="btn-close-session" class="w-full py-2 px-4 rounded-xl text-xs font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50 transition">
              Tutup Sesi Absensi
            </button>
          `
              : ""
          }
        </div>
      </div>

      <!-- Kolom Kanan: Daftar Peserta Kelas & Validasi Kehadiran -->
      <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="font-bold text-slate-800">Kehadiran & Validasi Peserta (${classParticipants.length})</h3>
            <p class="text-xs text-slate-500">Pantau check-in orang tua, ubah status bila perlu, atau tandai Alpha.</p>
          </div>
          <button type="button" id="btn-mark-alpha" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100">
            Tandai Alpha Yang Belum Absen
          </button>
        </div>

        ${
          classParticipants.length === 0
            ? `<p class="text-sm text-slate-500 py-4">Belum ada peserta aktif di kelas ini.</p>`
            : `
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
              <thead class="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th class="py-2.5 px-3">Peserta</th>
                  <th class="py-2.5 px-3">Kategori</th>
                  <th class="py-2.5 px-3">Status</th>
                  <th class="py-2.5 px-3">Ket. Ortu</th>
                  <th class="py-2.5 px-3">Validasi</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${classParticipants
                  .map((pst) => {
                    const att = attMap[pst.id];
                    const statusVal = att?.status_kehadiran || "belum_absen";
                    return `
                      <tr data-val-row="${pst.id}">
                        <td class="py-2.5 px-3">
                          <div class="font-semibold text-slate-800">${escapeHtml(pst.nama_lengkap)}</div>
                          <div class="text-xs text-slate-400">${escapeHtml(pst.nomor_induk || "-")}</div>
                        </td>
                        <td class="py-2.5 px-3">
                          <span class="px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                            pst.kategori === "atlet"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-indigo-100 text-indigo-800"
                          }">
                            ${escapeHtml(pst.kategori || "siswa")}
                          </span>
                        </td>
                        <td class="py-2.5 px-3">
                          <select class="val-status px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white">
                            <option value="belum_absen" ${statusVal === "belum_absen" ? "selected" : ""}>Belum Absen</option>
                            <option value="hadir" ${statusVal === "hadir" ? "selected" : ""}>Hadir</option>
                            <option value="izin" ${statusVal === "izin" ? "selected" : ""}>Izin</option>
                            <option value="sakit" ${statusVal === "sakit" ? "selected" : ""}>Sakit</option>
                            <option value="alpha" ${statusVal === "alpha" ? "selected" : ""}>Alpha</option>
                          </select>
                        </td>
                        <td class="py-2.5 px-3 text-xs text-slate-600 max-w-[180px]">
                          ${escapeHtml(att?.keterangan_ortu || "-")}
                          ${att?.diverifikasi_pelatih ? `<div class="text-[11px] text-emerald-700 font-medium">✓ Tervalidasi</div>` : ""}
                        </td>
                        <td class="py-2.5 px-3">
                          <button type="button" data-action="verify-pst" data-pst-id="${pst.id}" class="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                            Validasi
                          </button>
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
    `;

    if (activeSession) {
      const qrBox = panelContent.querySelector("#session-qr-box");
      renderQrIntoElement(qrBox, buildCheckinUrl(activeSession.id, activeSession.session_token));
    }

    // Buka / Putar PIN & QR Sesi Baru
    panelContent.querySelector("#btn-open-session")?.addEventListener("click", async () => {
      const durationMin = Math.max(10, Number(panelContent.querySelector("#pin-duration-min")?.value) || 60);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationMin * 60 * 1000);
      const pinCode = generatePinCode(4);
      const sessionToken = generateSessionToken();
      const sessionId = `sesi_${todayStr.replace(/-/g, "")}_${classId}_${Date.now().toString().slice(-4)}`;

      try {
        // Tutup sesi aktif sebelumnya pada kelas & tanggal ini agar hanya 1 sesi aktif
        for (const s of classSessions) {
          if (s.status_sesi === "aktif") {
            await updateDoc(doc(db, "attendance_sessions", s.id), {
              status_sesi: "ditutup",
              closed_at: now.toISOString()
            });
          }
        }

        await setDoc(doc(db, "attendance_sessions", sessionId), {
          class_id: classId,
          tanggal: todayStr,
          created_by_uid: user.uid,
          pin_code: pinCode,
          session_token: sessionToken,
          status_sesi: "aktif",
          opened_at: now.toISOString(),
          expires_at: expiresAt.toISOString()
        });

        showToast(`Sesi dibuka! PIN 4 digit: ${pinCode}`, "success");
        await refreshClassPanel(classId);
      } catch (err) {
        console.error(err);
        showToast("Gagal membuka sesi absensi.", "error");
      }
    });

    // Tutup Sesi Aktif
    panelContent.querySelector("#btn-close-session")?.addEventListener("click", async () => {
      if (!activeSession) return;
      try {
        await updateDoc(doc(db, "attendance_sessions", activeSession.id), {
          status_sesi: "ditutup",
          closed_at: new Date().toISOString()
        });
        showToast("Sesi absensi ditutup.", "info");
        await refreshClassPanel(classId);
      } catch (err) {
        console.error(err);
        showToast("Gagal menutup sesi absensi.", "error");
      }
    });

    // Validasi Kehadiran Per Peserta
    panelContent.querySelectorAll('button[data-action="verify-pst"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pstId = btn.dataset.pstId;
        const pstObj = classParticipants.find((p) => p.id === pstId);
        const row = panelContent.querySelector(`tr[data-val-row="${pstId}"]`);
        const chosenStatus = row.querySelector(".val-status").value;

        if (!pstObj || chosenStatus === "belum_absen") {
          showToast("Pilih status kehadiran (Hadir, Izin, Sakit, atau Alpha) terlebih dahulu.", "warning");
          return;
        }

        const attDocId = `${todayStr}_${classId}_${pstId}`;
        const existingAtt = attMap[pstId];

        try {
          await setDoc(
            doc(db, "attendances", attDocId),
            {
              tanggal: todayStr,
              class_id: classId,
              participant_id: pstId,
              nama_peserta: pstObj.nama_lengkap,
              kategori: pstObj.kategori || "siswa",
              status_kehadiran: chosenStatus,
              keterangan_ortu: existingAtt?.keterangan_ortu || "Divalidasi oleh pelatih",
              waktu_input_ortu: existingAtt?.waktu_input_ortu || new Date().toISOString(),
              diinput_oleh_uid: existingAtt?.diinput_oleh_uid || user.uid,
              diverifikasi_pelatih: true,
              verified_by_uid: user.uid,
              verified_at: new Date().toISOString()
            },
            { merge: true }
          );

          showToast(`Kehadiran ${pstObj.nama_lengkap} (${chosenStatus}) tervalidasi.`, "success");
          await refreshClassPanel(classId);
        } catch (err) {
          console.error(err);
          showToast("Gagal memvalidasi kehadiran.", "error");
        }
      });
    });

    // Tandai Alpha Massal Untuk Peserta Yang Belum Absen
    panelContent.querySelector("#btn-mark-alpha")?.addEventListener("click", async () => {
      const unmarked = classParticipants.filter((p) => !attMap[p.id]);
      if (unmarked.length === 0) {
        showToast("Semua peserta di kelas ini sudah memiliki catatan kehadiran hari ini.", "info");
        return;
      }

      try {
        for (const pstObj of unmarked) {
          const attDocId = `${todayStr}_${classId}_${pstObj.id}`;
          await setDoc(doc(db, "attendances", attDocId), {
            tanggal: todayStr,
            class_id: classId,
            participant_id: pstObj.id,
            nama_peserta: pstObj.nama_lengkap,
            kategori: pstObj.kategori || "siswa",
            status_kehadiran: "alpha",
            keterangan_ortu: "Tidak hadir tanpa keterangan",
            waktu_input_ortu: new Date().toISOString(),
            diinput_oleh_uid: user.uid,
            diverifikasi_pelatih: true,
            verified_by_uid: user.uid,
            verified_at: new Date().toISOString()
          });
        }

        showToast(`${unmarked.length} peserta ditandai Alpha.`, "success");
        await refreshClassPanel(classId);
      } catch (err) {
        console.error(err);
        showToast("Gagal menandai Alpha peserta.", "error");
      }
    });
  }

  classSelect?.addEventListener("change", () => refreshClassPanel(classSelect.value));
  await refreshClassPanel(defaultClassId);
}

// ============================================================================
// 2. INPUT & RIWAYAT PROGRAM LATIHAN PELATIH
// ============================================================================
async function renderProgramLatihan(container, state, user) {
  const { coachClasses } = state;
  const todayStr = getTodayISO();

  if (coachClasses.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="text-lg font-bold text-slate-800">Program Latihan Pelatih</h2>
        <p class="text-sm text-slate-500 mt-1">Belum ada kelas yang ditugaskan ke akun Anda.</p>
      </div>
    `;
    return;
  }

  const classMap = Object.fromEntries(coachClasses.map((c) => [c.id, c]));

  container.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <form id="form-program-latihan" class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Input Program Latihan Kelas</h2>
          <p class="text-xs text-slate-500">Susun target sesi latihan, volume jarak, dan catatan evaluasi pelatih.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Kelas</label>
            <select id="prg-class" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              ${coachClasses.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal Latihan</label>
            <input type="date" id="prg-date" value="${todayStr}" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Total Volume (Meter)</label>
            <input type="number" id="prg-volume" min="0" step="50" placeholder="Contoh: 2500" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Judul / Fokus Sesi</label>
            <input type="text" id="prg-title" required placeholder="Contoh: Teknik Start & Endurance Gaya Bebas" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Fokus Gaya / Materi</label>
            <input type="text" id="prg-styles" placeholder="Contoh: Gaya Bebas, Gaya Dada, Kick" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Pemanasan Kering (Dryland)</label>
            <textarea id="prg-dryland" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Mobilitas bahu, core, peregangan..."></textarea>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Warm Up (Pemanasan di Air)</label>
            <textarea id="prg-warmup" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: 400m bebas santai + drill..."></textarea>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">Main Set (Latihan Inti)</label>
          <textarea id="prg-mainset" rows="3" required class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Rincian repetisi, jarak, interval waktu, atau fokus teknik..."></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Cool Down (Pendinginan)</label>
            <textarea id="prg-cooldown" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: 200m rileks / mengapung..."></textarea>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Catatan Evaluasi Pelatih</label>
            <textarea id="prg-notes" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Evaluasi performa atau catatan khusus..."></textarea>
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" id="prg-show-parent" checked class="rounded border-slate-300 text-sky-600" />
          Tampilkan ringkasan program latihan ini ke akun Orang Tua
        </label>

        <div>
          <button type="submit" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white transition">
            Simpan Program Latihan
          </button>
        </div>
      </form>

      <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 h-fit">
        <h3 class="font-bold text-slate-800">Arsip Program Terbaru</h3>
        <div id="prg-history-list" class="space-y-3">
          <p class="text-xs text-slate-500">Memuat riwayat program...</p>
        </div>
      </div>
    </div>
  `;

  const historyList = container.querySelector("#prg-history-list");

  async function loadProgramHistory() {
    const snap = await getDocs(collection(db, "training_programs"));
    const allowedClassIds = new Set(coachClasses.map((c) => c.id));
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => allowedClassIds.has(p.class_id))
      .sort((a, b) => String(b.tanggal_latihan || "").localeCompare(String(a.tanggal_latihan || "")))
      .slice(0, 10);

    if (items.length === 0) {
      historyList.innerHTML = `<p class="text-xs text-slate-500">Belum ada program latihan tersimpan.</p>`;
      return;
    }

    historyList.innerHTML = items
      .map(
        (p) => `
      <div class="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-sky-800">${escapeHtml(classMap[p.class_id]?.nama_kelas || p.class_id)}</span>
          <span class="text-[11px] text-slate-500">${escapeHtml(p.tanggal_latihan || "-")}</span>
        </div>
        <div class="font-semibold text-sm text-slate-800">${escapeHtml(p.judul_sesi || "Program Latihan")}</div>
        <div class="text-xs text-slate-600 whitespace-pre-line">${escapeHtml(p.detail_program?.main_set || "")}</div>
        <div class="text-[11px] text-slate-500 pt-1">
          Volume: <strong>${escapeHtml(String(p.total_volume_meter || 0))}m</strong> · ${
          p.tampilkan_ke_orangtua ? "Terlihat oleh Ortu" : "Internal Pelatih"
        }
        </div>
      </div>
    `
      )
      .join("");
  }

  container.querySelector("#form-program-latihan")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const classId = container.querySelector("#prg-class").value;
    const tanggalLatihan = container.querySelector("#prg-date").value;
    const volumeMeter = Number(container.querySelector("#prg-volume").value) || 0;
    const judulSesi = container.querySelector("#prg-title").value.trim();
    const fokusGaya = container
      .querySelector("#prg-styles")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const dryland = container.querySelector("#prg-dryland").value.trim();
    const warmUp = container.querySelector("#prg-warmup").value.trim();
    const mainSet = container.querySelector("#prg-mainset").value.trim();
    const coolDown = container.querySelector("#prg-cooldown").value.trim();
    const catatanEvaluasi = container.querySelector("#prg-notes").value.trim();
    const tampilkanKeOrangtua = container.querySelector("#prg-show-parent").checked;

    const docId = `prg_${tanggalLatihan.replace(/-/g, "")}_${classId}_${Date.now().toString().slice(-4)}`;

    try {
      await setDoc(doc(db, "training_programs", docId), {
        class_id: classId,
        coach_uid: user.uid,
        tanggal_latihan: tanggalLatihan,
        judul_sesi: judulSesi,
        fokus_gaya: fokusGaya,
        total_volume_meter: volumeMeter,
        detail_program: {
          dryland,
          warm_up: warmUp,
          main_set: mainSet,
          cool_down: coolDown
        },
        catatan_evaluasi_pelatih: catatanEvaluasi,
        tampilkan_ke_orangtua: tampilkanKeOrangtua,
        updated_at: new Date().toISOString()
      });

      showToast("Program latihan berhasil disimpan.", "success");
      e.target.reset();
      container.querySelector("#prg-date").value = tanggalLatihan;
      container.querySelector("#prg-show-parent").checked = true;
      await loadProgramHistory();
    } catch (err) {
      console.error(err);
      showToast("Gagal menyimpan program latihan.", "error");
    }
  });

  await loadProgramHistory();
}

// ============================================================================
// 3. REKAP KEHADIRAN KELAS PELATIH (TERPISAH ATLET & SISWA)
// ============================================================================
async function renderRekapKelas(container, state) {
  const { coachClasses } = state;
  const todayStr = getTodayISO();

  if (coachClasses.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 class="text-lg font-bold text-slate-800">Rekap Kehadiran Kelas</h2>
        <p class="text-sm text-slate-500 mt-1">Belum ada kelas yang ditugaskan ke akun Anda.</p>
      </div>
    `;
    return;
  }

  const classMap = Object.fromEntries(coachClasses.map((c) => [c.id, c]));

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Rekap Kehadiran Kelas (Atlet & Siswa Terpisah)</h2>
          <p class="text-xs text-slate-500">Data kehadiran kelas yang diampu dikelompokkan terpisah antara Atlet dan Siswa.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <input type="date" id="coach-rekap-date" value="${todayStr}" class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          <select id="coach-rekap-class" class="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Semua Kelas Saya</option>
            ${coachClasses.map((c) => `<option value="${c.id}">${escapeHtml(c.nama_kelas)}</option>`).join("")}
          </select>
          <button type="button" id="btn-coach-rekap-load" class="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            Muat Rekap
          </button>
        </div>
      </div>

      <div id="coach-rekap-output" class="grid grid-cols-1 lg:grid-cols-2 gap-5"></div>
    </div>
  `;

  function buildSubTable(title, badgeClass, rows) {
    if (rows.length === 0) {
      return `
        <div class="border border-slate-200 rounded-xl p-4">
          <h3 class="font-bold text-slate-800 mb-2">${title} <span class="text-xs font-normal text-slate-400">(0)</span></h3>
          <p class="text-xs text-slate-500">Belum ada data kehadiran ${title.toLowerCase()} pada tanggal ini.</p>
        </div>
      `;
    }

    return `
      <div class="border border-slate-200 rounded-xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-slate-800">${title}</h3>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${rows.length} data</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left">
            <thead class="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th class="py-2 px-2.5">Nama</th>
                <th class="py-2 px-2.5">Kelas</th>
                <th class="py-2 px-2.5">Status</th>
                <th class="py-2 px-2.5">Validasi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${rows
                .map(
                  (r) => `
                <tr>
                  <td class="py-2 px-2.5 font-semibold text-slate-800">${escapeHtml(r.nama_peserta || r.participant_id)}</td>
                  <td class="py-2 px-2.5 text-slate-600">${escapeHtml(classMap[r.class_id]?.nama_kelas || r.class_id)}</td>
                  <td class="py-2 px-2.5">
                    <span class="px-2 py-0.5 rounded-full font-semibold border ${getStatusBadge(r.status_kehadiran)}">
                      ${escapeHtml(r.status_kehadiran || "-")}
                    </span>
                  </td>
                  <td class="py-2 px-2.5">${r.diverifikasi_pelatih ? "✓" : "Menunggu"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function loadCoachRekap() {
    const targetDate = container.querySelector("#coach-rekap-date").value;
    const selectedClass = container.querySelector("#coach-rekap-class").value;
    const outputEl = container.querySelector("#coach-rekap-output");

    const q = targetDate
      ? query(collection(db, "attendances"), where("tanggal", "==", targetDate))
      : collection(db, "attendances");
    const snap = await getDocs(q);

    const allowedClassIds = new Set(coachClasses.map((c) => c.id));
    let rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => allowedClassIds.has(r.class_id));

    if (selectedClass) {
      rows = rows.filter((r) => r.class_id === selectedClass);
    }

    const atletRows = rows.filter((r) => r.kategori === "atlet");
    const siswaRows = rows.filter((r) => r.kategori !== "atlet");

    outputEl.innerHTML =
      buildSubTable("Daftar Hadir Atlet", "bg-sky-100 text-sky-800", atletRows) +
      buildSubTable("Daftar Hadir Siswa", "bg-indigo-100 text-indigo-800", siswaRows);
  }

  container.querySelector("#btn-coach-rekap-load")?.addEventListener("click", loadCoachRekap);
  await loadCoachRekap();
}

// ============================================================================
// ENTRY POINT RENDER VIEW (DIPANGGIL OLEH ROUTER)
// ============================================================================
export async function renderView({ container, view, user }) {
  const state = await fetchCoachState(user);

  switch (view) {
    case "sesi":
      await renderSesiAbsensi(container, state, user);
      break;
    case "program":
      await renderProgramLatihan(container, state, user);
      break;
    case "rekap":
      await renderRekapKelas(container, state);
      break;
    default:
      await renderSesiAbsensi(container, state, user);
      break;
  }
}
