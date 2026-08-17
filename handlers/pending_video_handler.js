// handlers/pending_video_handler.js
//
// Dipanggil sebagai subprocess: `bun run pending_video_handler.js <fungsi> '<json>'`
// Dua entry point:
//   - checkPreflight: dipanggil ExtensionManager dalam mode "check", SEBELUM
//     render sungguhan. Menentukan apakah perlu konfirmasi user (mis. resolusi
//     gambar campuran) — logic ini dulunya ada di video_executor.rs
//     (cek_dimensi_gambar + dimensi_seragam), dipindah ke sini karena core
//     TIDAK BOLEH punya pengetahuan apriori soal aturan spesifik FFmpeg.
//   - handlePending: dipanggil setelah user menjawab prompt konfirmasi.
//
// PENTING: deteksi "apakah user menjawab ya/tidak" TIDAK diimplementasikan
// ulang di sini — dipakai langsung dari video_intent_parser.js
// (adalahKonfirmasiLanjut), supaya satu sumber kebenaran untuk kata kunci
// konfirmasi di seluruh extension, bukan dua implementasi yang bisa divergen.
 
import { execFileSync } from "child_process";
import { adalahKonfirmasiLanjut } from "../parsers/video_intent_parser.js";
 
function cekDimensiGambar(binFfprobe, pathGambar) {
  const hasil = [];
  for (const path of pathGambar) {
    try {
      const output = execFileSync(binFfprobe, [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        path,
      ]).toString().trim();
 
      const [lebar, tinggi] = output.split("x").map((n) => parseInt(n, 10));
      if (!Number.isNaN(lebar) && !Number.isNaN(tinggi)) {
        hasil.push({ path, lebar, tinggi });
      }
    } catch (err) {
      console.error(`⚠️ ffprobe gagal untuk ${path}, dilewati dari pengecekan dimensi.`);
    }
  }
  return hasil;
}
 
function dimensiSeragam(daftar) {
  if (daftar.length <= 1) return true;
  const acuan = `${daftar[0].lebar}x${daftar[0].tinggi}`;
  return daftar.every((d) => `${d.lebar}x${d.tinggi}` === acuan);
}
 
/**
 * mode "check" — dipanggil sebelum render sungguhan.
 * input: { mode, capability_id, params, bin_paths: { ffmpeg, ffprobe } }
 * output: {} kalau siap langsung eksekusi, atau
 *         { needs_confirmation: "<kalimat siap tampil ke user>" }
 */
function checkPreflight(inputJson) {
  const { params, bin_paths } = JSON.parse(inputJson);
  const pathGambar = params.images || [];
 
  if (pathGambar.length < 2) {
    // Satu gambar atau kosong — tidak ada isu resolusi campuran untuk dicek.
    return { params };
  }
 
  const dimensi = cekDimensiGambar(bin_paths.ffprobe, pathGambar);
  if (dimensiSeragam(dimensi)) {
    return { params };
  }
 
  const ringkasan = dimensi
    .map((d) => `${d.path.split("/").pop()} (${d.lebar}x${d.tinggi})`)
    .join(", ");
 
  return {
    needs_confirmation:
      `Gambar yang kamu lampirkan punya resolusi berbeda-beda: ${ringkasan}. ` +
      `Saya akan menyesuaikan semuanya ke satu ukuran dengan letterbox hitam supaya tidak terpotong. ` +
      `Lanjutkan? (ya/tidak)`,
  };
}
 
/**
 * Dipanggil setelah user menjawab prompt checkPreflight tadi.
 * input: { pending_data: { extension_id, capability_id, params }, text, attachment_paths }
 * output: { params: {...} } untuk lanjut eksekusi, atau
 *         { message: "..." } untuk membatalkan tanpa eksekusi lanjutan.
 *
 * Penolakan dideteksi eksplisit lewat kata kunci negatif — SEBELUM dicek
 * apakah ini konfirmasi "ya", karena adalahKonfirmasiLanjut tidak menangani
 * negasi (dia cuma tahu daftar kata AFIRMATIF, bukan penolakan). Kalau
 * bukan penolakan eksplisit DAN bukan konfirmasi jelas, kita tetap anggap
 * "ya" — lebih ramah untuk jawaban santai ("oke", "gas") daripada memblokir
 * user yang jawabannya tidak persis cocok kata kunci.
 */
function handlePending(inputJson) {
  const { pending_data, text } = JSON.parse(inputJson);
  const jawaban = (text || "").trim().toLowerCase();
 
  const kataPenolakan = ["tidak", "no", "batal", "jangan", "gajadi", "ga jadi"];
  const menolak = kataPenolakan.some((kata) => jawaban.includes(kata));
  if (menolak) {
    return { message: "Baik, render dibatalkan. Kirim ulang gambar dengan resolusi seragam kalau berubah pikiran." };
  }
 
  // Diterima secara eksplisit ATAU jawaban ambigu (bukan penolakan, bukan
  // kata kunci afirmatif baku) — keduanya dianggap "ya" untuk kelanjutan.
  const _diterimaEksplisit = adalahKonfirmasiLanjut(jawaban);
  return { params: pending_data.params };
}
 
// ── Entry point subprocess ──────────────────────────────────────
const [, , fnName, inputArg] = process.argv;
 
const fungsi = { checkPreflight, handlePending };
 
if (fungsi[fnName]) {
  const hasil = fungsi[fnName](inputArg);
  console.log(JSON.stringify(hasil));
} else {
  console.error(`Fungsi '${fnName}' tidak dikenal di pending_video_handler.js`);
  process.exit(1);
}
 