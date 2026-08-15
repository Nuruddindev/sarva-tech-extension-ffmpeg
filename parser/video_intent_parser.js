// parsers/video_intent_parser.js
//
// Dipanggil sebagai subprocess: `bun run video_intent_parser.js extractParameters '<json>'`
// Business logic murni FFmpeg + parsing niat video dari bahasa natural.
// Ini adalah PORT LENGKAP dari intent/video_intent.rs (core Rust lama) —
// dipindah ke sini karena core tidak boleh punya pengetahuan apriori soal
// domain video/FFmpeg, sesuai prinsip yang dipegang di seluruh extension
// system ini. Setiap fungsi di bawah punya padanan 1:1 di video_intent.rs
// lama (nama fungsi asli dicatat di komentar tiap fungsi) — porting ini
// dimaksudkan SETARA ATAU LEBIH LENGKAP, bukan mundur dari versi Rust.

const EKSTENSI_DIDUKUNG = ["jpg", "jpeg", "png"];

/// Padanan: deteksi_durasi_dari_teks (video_intent.rs)
/// Mendeteksi durasi baik dari angka eksplisit ("2 detik", "2.5 detik")
/// maupun frasa kualitatif ("agak lama", "cepat") — port lengkap, bukan
/// cuma regex angka seperti versi awal JS ini.
function deteksiDurasi(teks) {
  const t = teks.toLowerCase();

  // Angka eksplisit diikuti "detik"/"second"/"sec" — dicek token demi
  // token (bukan regex tunggal) supaya konsisten dengan versi Rust yang
  // memisahkan whitespace lalu cek token berikutnya, menghindari salah
  // tangkap seperti "video 2 dari 5 detik lalu" (angka yang tidak
  // langsung diikuti kata durasi).
  const kata = t.split(/\s+/);
  for (let i = 0; i < kata.length; i++) {
    const tokenBersih = kata[i].replace(/[^\d.]/g, "");
    const angka = parseFloat(tokenBersih);
    if (!Number.isNaN(angka) && tokenBersih !== "") {
      const kataSetelah = kata[i + 1] || "";
      if (kataSetelah.includes("detik") || kataSetelah.includes("second") || kataSetelah.includes("sec")) {
        return angka;
      }
    }
  }

  // Frasa kualitatif — urutan pengecekan PENTING: frasa lebih spesifik
  // ("sangat lama") harus dicek sebelum frasa umum ("lama") supaya tidak
  // salah tangkap parsial. Sama seperti urutan array di video_intent.rs.
  const pemetaanKualitatif = [
    ["sangat lama", 6.0],
    ["agak lama", 3.0],
    ["lebih lama", 3.0],
    ["lama", 3.0],
    ["sangat cepat", 0.5],
    ["lebih cepat", 0.5],
    ["agak cepat", 0.7],
    ["cepat", 0.5],
  ];
  for (const [frasa, nilai] of pemetaanKualitatif) {
    if (t.includes(frasa)) return nilai;
  }

  return null; // null = tidak terdeteksi, pemanggil yang tentukan default (beda dari Option<f32> None di Rust)
}

/// Padanan: adalah_konfirmasi_lanjut (video_intent.rs)
/// Dipakai pending_video_handler.js untuk menafsirkan jawaban user atas
/// prompt konfirmasi (mis. preflight resolusi campuran) — dipindah ke sini
/// supaya satu sumber kebenaran untuk kata kunci konfirmasi, bukan
/// terpisah antara video_intent_parser.js dan pending_video_handler.js.
function adalahKonfirmasiLanjut(teks) {
  const t = teks.toLowerCase().trim().replace(/[.!,?\s]+$/, "");
  const kataKunci = ["ya", "lanjut", "oke", "ok", "boleh", "silakan", "laksanakan", "gas", "iya", "setuju"];
  return kataKunci.some((k) => t === k || t.startsWith(`${k} `));
}

/// Padanan: adalah_permintaan_ulangi_video (video_intent.rs)
/// CATATAN ARSITEKTUR: di Rust lama, deteksi ini dipanggil routing.rs
/// (core) untuk memutuskan kapan memanggil ulang video_executor dengan
/// data lama dari DB. Di extension system yang baru, keputusan "apakah ini
/// permintaan ulangi" SUDAH dipindah ke regex matcher capability
/// "media.video.rebuild_last" di manifest.json — core tidak lagi
/// menjalankan deteksi teks bebas semacam ini sendiri. Fungsi ini
/// dipertahankan di sini (bukan dihapus) supaya matcher manifest bisa
/// diperkaya lebih lanjut kalau regex sederhana di manifest.json ternyata
/// kurang menangkap variasi bahasa yang fungsi ini tangani.
function adalahPermintaanUlangiVideo(teks) {
  const t = teks.toLowerCase();
  const kataKunci = [
    "ulangi", "ulang", "rebuild", "recreate", "buat ulang", "render ulang",
    "bikin ulang", "susun ulang", "rakit ulang", "coba lagi", "generate ulang",
    "buat lagi", "render lagi", "bikin lagi",
  ];
  return kataKunci.some((k) => t.includes(k));
}

/// Padanan: ekstrak_ratio_custom (video_intent.rs)
/// Parsing "16:9", "1080x1920", "9:16 saja" dari teks bebas. Rasio KECIL
/// (mis. "9:16") diskalakan ke lebar dasar 720 supaya hasilnya resolusi
/// wajar, bukan video 9x16 piksel — logic ini PERSIS sama dengan versi Rust.
function ekstrakRatioCustom(teks) {
  for (const pemisah of ["x", "X", ":"]) {
    const idx = teks.indexOf(pemisah);
    if (idx === -1) continue;

    const sebelumMatch = teks.slice(0, idx).match(/(\d+)$/);
    const sesudahMatch = teks.slice(idx + 1).match(/^(\d+)/);
    if (!sebelumMatch || !sesudahMatch) continue;

    const l = parseInt(sebelumMatch[1], 10);
    const t = parseInt(sesudahMatch[1], 10);
    if (l > 0 && t > 0) {
      if (l < 100 && t < 100) {
        const skala = 720.0 / l;
        return { width: 720, height: Math.round(t * skala) };
      }
      return { width: l, height: t };
    }
  }
  return null;
}

/// Padanan: deteksi_jenis_transisi (video_intent.rs), digabung dengan
/// perbaikan bug word-boundary & negasi yang sudah dibuat di iterasi
/// sebelumnya JS ini (video_intent.rs Rust TIDAK punya kedua fix ini —
/// "buat video slideshow tanpa transisi" akan salah terdeteksi "fade" di
/// versi Rust karena kata "transisi" tetap match, dan "slideshow" akan
/// salah terdeteksi "slide" karena substring match tanpa word-boundary).
/// Porting ke JS ini sekaligus jadi kesempatan membawa perbaikan itu balik
/// tanpa regresi — bukan cuma salin apa adanya.
function deteksiTransisi(teks) {
  const t = teks.toLowerCase();

  if (/\btanpa\s+transisi\b/.test(t) || /\bno\s+transition\b/.test(t) || /\btanpa\s+efek\b/.test(t)) {
    return "none";
  }

  if (/\bslide(kan|ing)?\b/.test(t) || /\bgeser\b/.test(t)) return "slide";
  if (/\bwipe\b/.test(t) || /\busap\b/.test(t)) return "wipe";
  if (/\bfade\b/.test(t) || /\bcrossfade\b/.test(t) || /\btransisi\b/.test(t)) return "fade";
  return "none";
}

/// Padanan: deteksi_preset_platform (video_intent.rs)
/// Preset ratio + batas durasi wajar per platform. batas_detik_total HANYA
/// dipakai untuk WARNING (lihat peringatanDurasiPlatform), tidak memotong
/// render secara otomatis — keputusan desain yang sama dipertahankan dari
/// versi Rust: user yang putuskan sendiri kalau mau menyesuaikan durasi.
function deteksiPresetPlatform(teks) {
  const t = teks.toLowerCase();
  if (t.includes("tiktok")) return { width: 1080, height: 1920, batasDetik: 60.0 };
  if (t.includes("reels") || t.includes("reel ")) return { width: 1080, height: 1920, batasDetik: 90.0 };
  if (t.includes("instagram story") || t.includes("ig story") || t.includes("story ig")) {
    return { width: 1080, height: 1920, batasDetik: 15.0 };
  }
  if (t.includes("instagram") || t.includes(" ig ") || t.includes("ig,")) {
    return { width: 1080, height: 1920, batasDetik: 60.0 };
  }
  return null;
}

/// Padanan: peringatan_durasi_platform (video_intent.rs)
/// Pesan PERINGATAN (bukan pemblokiran) kalau total durasi melebihi batas
/// platform yang terdeteksi. null kalau tidak ada preset ATAU durasi masih
/// di bawah batas.
function peringatanDurasiPlatform(jumlahGambar, durasiPerGambar, batasDetik) {
  const totalDurasi = jumlahGambar * durasiPerGambar;
  if (totalDurasi > batasDetik) {
    return (
      `⚠️ Perhatian: total durasi video ini (${totalDurasi.toFixed(1)} detik) melebihi batas wajar platform yang Anda sebutkan (~${batasDetik.toFixed(0)} detik). ` +
      `Video tetap dirender apa adanya — kalau ingin dipersingkat, sebutkan durasi per gambar yang lebih pendek (misal "0.5 detik per gambar") dan saya rakit ulang.`
    );
  }
  return null;
}

function deteksiRatio(teks) {
  const t = teks.toLowerCase();
  if (t.includes("landscape") || t.includes("16:9") || t.includes("youtube")) {
    return { width: 1280, height: 720 };
  }
  if (t.includes("square") || t.includes("1:1") || t.includes("instagram post")) {
    return { width: 1080, height: 1080 };
  }
  // Default portrait — TikTok/Reels/Shorts.
  return { width: 720, height: 1280 };
}

function bulatkanGenap(n) {
  return n % 2 === 0 ? n : n - 1;
}

/**
 * input: { text, attachment_paths }
 * output: params siap dipakai executor, termasuk field "template" yang
 * menentukan template argumen mana di manifest.executor.templates yang
 * dipakai, dan "warning" opsional (peringatan durasi platform) yang boleh
 * ditampilkan ke user di pesan hasil render.
 *
 * Urutan resolusi ratio, PALING SPESIFIK MENANG DULUAN:
 *   1. Preset platform (TikTok/Reels/Story) — juga membawa batas durasi.
 *   2. Ratio custom eksplisit dari teks ("16:9", "1080x1920").
 *   3. Fallback ke deteksiRatio generik (keyword landscape/square/portrait).
 * Ini beda dari versi lama yang cuma pakai deteksiRatio sendirian — sekarang
 * setara dengan video_intent.rs yang punya tiga jalur deteksi ratio terpisah.
 */
function extractParameters(inputJson) {
  const { text, attachment_paths } = JSON.parse(inputJson);

  const images = (attachment_paths || []).filter((p) => {
    const ext = p.split(".").pop().toLowerCase();
    return EKSTENSI_DIDUKUNG.includes(ext);
  });

  const durasiTerdeteksi = deteksiDurasi(text);
  const durasiMentah = durasiTerdeteksi === null ? 2.0 : durasiTerdeteksi; // default 2.0 kalau tidak terdeteksi sama sekali
  const durasi = Math.min(Math.max(durasiMentah, 0.1), 60.0);

  const transisi = deteksiTransisi(text);

  const preset = deteksiPresetPlatform(text);
  const ratioCustom = ekstrakRatioCustom(text);

  let width, height, warning;
  if (preset) {
    ({ width, height } = preset);
    warning = peringatanDurasiPlatform(images.length, durasi, preset.batasDetik);
  } else if (ratioCustom) {
    ({ width, height } = ratioCustom);
    warning = null;
  } else {
    ({ width, height } = deteksiRatio(text));
    warning = null;
  }

  const params = {
    images,
    duration_per_image: durasi,
    width: bulatkanGenap(width),
    height: bulatkanGenap(height),
    transition: transisi,
    output_path: `/tmp/sarva_slideshow_${Date.now()}.mp4`,
    template: transisi === "none" ? "concat" : "transition",
  };

  const hasil = { params };
  if (warning) hasil.warning = warning;
  return hasil;
}

// ── Pre-hooks: menghitung nilai kompleks yang tidak bisa diisi lewat
// substitusi placeholder sederhana di executor.templates.args (mis. string
// panjang hasil loop per gambar). Dulunya dua skrip bash terpisah
// (generate_concat.sh, generate_transition.sh) — dipindah ke sini supaya:
//   1. Jalan di Windows tanpa bash/WSL.
//   2. Tidak butuh dependency `bc` untuk floating point.
//   3. Satu sumber kebenaran untuk kalkulasi durasi transisi & resolusi,
//      bukan duplikat logic yang gampang divergen dari extractParameters.

/**
 * Escape path untuk concat demuxer FFmpeg: single-quote di dalam path
 * harus di-escape sebagai '\'' (tutup quote, backslash-quote literal, buka
 * quote lagi) — ini syntax resmi yang didukung FFmpeg concat demuxer.
 * Bug di generate_concat.sh lama: path dengan karakter ' menghasilkan
 * syntax rusak karena tidak ada escaping sama sekali.
 */
function escapeConcatPath(path) {
  return path.replace(/'/g, `'\\''`);
}

/**
 * pre_hook untuk template "concat". Menghasilkan isi file concat_list.txt
 * sebagai string, termasuk workaround wajib FFmpeg: baris "file" terakhir
 * harus diulang TANPA "duration" sesudahnya (durasi entri terakhir dihitung
 * dari selisih ke entri berikutnya dalam spesifikasi concat demuxer — tanpa
 * pengulangan ini, frame terakhir berdurasi 0 dan hilang dari output).
 *
 * input: { params: { images: [...], duration_per_image } }
 * output: { concat_list: "<isi file lengkap>" }
 */
function buildConcatList(inputJson) {
  const { params } = JSON.parse(inputJson);
  const { images, duration_per_image } = params;

  if (!images || images.length === 0) {
    throw new Error("buildConcatList: tidak ada gambar untuk dirakit.");
  }

  let isi = "";
  for (const path of images) {
    isi += `file '${escapeConcatPath(path)}'\n`;
    isi += `duration ${duration_per_image.toFixed(6)}\n`;
  }
  // Ulangi baris file terakhir tanpa duration — kuirk concat demuxer.
  isi += `file '${escapeConcatPath(images[images.length - 1])}'\n`;

  return { concat_list: isi };
}

/**
 * Durasi transisi: proporsional (40% dari durasi tampil), dibatasi maks 1.0
 * detik, minimum 0.15 detik. Kalau durasi_transisi masih >= durasi tampil
 * (kasus gambar sangat sebentar), turunkan paksa supaya tidak overlap negatif.
 * Logic ini SATU-SATUNYA tempat kalkulasi durasi transisi — sebelumnya
 * duplikat antara video_executor.rs dan generate_transition.sh.
 */
function hitungDurasiTransisi(durasiPerGambar) {
  const awal = Math.min(Math.max(durasiPerGambar * 0.4, 0.15), 1.0);
  if (awal >= durasiPerGambar) {
    return Math.max(durasiPerGambar * 0.3, 0.05);
  }
  return awal;
}

const XFADE_MAP = { slide: "slideleft", wipe: "wipeleft" };

/**
 * pre_hook untuk template "transition". Menghasilkan filter_complex string
 * lengkap (scale+pad tiap input, lalu xfade berantai) dan input_options
 * (argumen -loop/-t/-i per gambar), plus map output final.
 *
 * input: { params: { images, duration_per_image, width, height, transition } }
 * output: { filter_complex: "...", input_options: [...], map_label: "vout" }
 */
function buildFilterComplex(inputJson) {
  const { params } = JSON.parse(inputJson);
  const { images, duration_per_image, width, height, transition } = params;
  const jumlah = images.length;

  if (jumlah === 0) {
    throw new Error("buildFilterComplex: tidak ada gambar untuk dirakit.");
  }

  const xfade = XFADE_MAP[transition] || "fade";
  const transDurasi = hitungDurasiTransisi(duration_per_image);
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  // input_options: setiap gambar jadi input terpisah, di-loop selama durasi tampilnya.
  const inputOptions = [];
  for (const path of images) {
    inputOptions.push("-loop", "1", "-t", duration_per_image.toFixed(6), "-i", path);
  }

  let filterComplex = "";
  for (let i = 0; i < jumlah; i++) {
    filterComplex += `[${i}:v]${scalePad}[v${i}];`;
  }

  // Kasus 1 gambar: tidak ada xfade sama sekali, langsung pakai [v0].
  if (jumlah === 1) {
    filterComplex = filterComplex.replace(/;$/, "");
    return { filter_complex: filterComplex, input_options: inputOptions, map_label: "v0" };
  }

  let labelSebelumnya = "v0";
  for (let i = 1; i < jumlah; i++) {
    const labelHasil = i === jumlah - 1 ? "vout" : `x${i}`;
    const offset = Math.max(i * duration_per_image - i * transDurasi, 0);
    filterComplex += `[${labelSebelumnya}][v${i}]xfade=transition=${xfade}:duration=${transDurasi.toFixed(6)}:offset=${offset.toFixed(6)}[${labelHasil}];`;
    labelSebelumnya = labelHasil;
  }
  filterComplex = filterComplex.replace(/;$/, "");

  return { filter_complex: filterComplex, input_options: inputOptions, map_label: "vout" };
}

const [, , fnName, inputArg] = process.argv;
const fungsi = { extractParameters, buildConcatList, buildFilterComplex };

// Export eksplisit supaya file lain (pending_video_handler.js) bisa
// mengimpor fungsi individual, bukan reimplementasi ulang logic yang sama
// (mis. adalahKonfirmasiLanjut) — satu sumber kebenaran untuk seluruh
// extension, bukan cuma untuk entry-point CLI ini.
export {
  deteksiDurasi,
  adalahKonfirmasiLanjut,
  adalahPermintaanUlangiVideo,
  ekstrakRatioCustom,
  deteksiTransisi,
  deteksiPresetPlatform,
  peringatanDurasiPlatform,
  extractParameters,
  buildConcatList,
  buildFilterComplex,
};

// Entry point CLI hanya berjalan kalau file ini dieksekusi langsung oleh
// Bun (`bun run video_intent_parser.js ...`), BUKAN saat diimpor sebagai
// module oleh pending_video_handler.js — tanpa guard ini, mengimpor file
// ini akan ikut menjalankan (dan mungkin process.exit) logic CLI yang
// tidak relevan untuk pemanggil import.
if (import.meta.main) {
  if (fungsi[fnName]) {
    console.log(JSON.stringify(fungsi[fnName](inputArg)));
  } else {
    console.error(`Fungsi '${fnName}' tidak dikenal di video_intent_parser.js`);
    process.exit(1);
  }
}