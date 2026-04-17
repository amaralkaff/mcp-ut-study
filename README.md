# MCP UT Study-Assistant

MCP server untuk **belajar** di `elearning.ut.ac.id` (Moodle Universitas Terbuka).
Stack: TypeScript + Bun + `@modelcontextprotocol/sdk` + `puppeteer-real-browser` + `cheerio` + `turndown`.

## Filosofi & Batasan

Server ini **HANYA untuk membantu belajar**. Yang dilakukan:

- ✅ Baca daftar mata kuliah, section, materi
- ✅ Ubah materi jadi markdown bersih untuk didiskusikan dengan AI
- ✅ Lihat metadata kuis/tugas (deadline, sisa attempt, dsb.)
- ✅ Ambil pertanyaan kuis untuk dipelajari (hanya dari halaman `preview` / `review` / yang sudah Anda buka sendiri)
- ✅ Baca status kehadiran yang sudah tercatat
- ✅ Ekspor seluruh materi ke file markdown

Yang **TIDAK** dilakukan (sengaja tidak ada, bukan terlewat):

- ❌ Submit jawaban kuis secara otomatis
- ❌ Menandai hadir / bypass absensi
- ❌ Mengerjakan tugas atas nama Anda

Kalau Anda pakai ini untuk curang di kuis bernilai, itu pelanggaran integritas akademik UT — risikonya DO. Gunakan dengan bijak.

## Tools

| Tool | Fungsi |
|------|--------|
| `check_login` | Cek status login sesi Moodle |
| `login` | Login dengan NIM + password |
| `list_courses` | Daftar mata kuliah Anda |
| `list_sections` | Daftar section + aktivitas pada satu course |
| `read_material` | Ambil isi materi sebagai markdown |
| `list_assessments` | Daftar kuis/tugas + metadata (read-only) |
| `get_quiz_questions` | Ambil soal untuk dipelajari (perlu `confirmStudyOnly: true`) |
| `list_attendance_sessions` | Baca status kehadiran (read-only) |
| `export_notes` | Ekspor semua materi baca ke `exports/*.md` |

## Instalasi

```bash
cd mcp-ut-study
bun install
```

## Konfigurasi MCP Client

Tambahkan ke konfigurasi MCP (Claude Desktop / Cursor / dsb.):

```json
{
  "mcpServers": {
    "ut-study": {
      "command": "bun",
      "args": ["run", "/Users/amangly/mcp-ut-study/src/index.ts"]
    }
  }
}
```

## Alur Pakai

1. `check_login` → kalau belum login, panggil `login` dengan NIM/password
2. `list_courses` → pilih `courseId`
3. `list_sections` atau `export_notes` → pelajari materi
4. `list_assessments` → lihat deadline
5. Pelajari soal secara mandiri; diskusikan dengan AI via materi yang sudah diekspor

## Catatan Teknis

- Cookie disimpan di `./cookies.json` di root proyek (jangan di-commit, sudah di `.gitignore`)
- Browser Chrome akan muncul (non-headless) karena Moodle UT kadang pakai proteksi tambahan
- Host yang diizinkan: hanya `elearning.ut.ac.id` — di-hardcode di `src/browser.ts`

## Lisensi

MIT
