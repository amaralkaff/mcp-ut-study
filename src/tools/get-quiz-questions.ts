import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry, getPage } from "../browser.js";
import type { QuizQuestion } from "../types.js";

/**
 * CATATAN ETIKA: Alat ini HANYA untuk belajar — mengambil pertanyaan dari halaman
 * preview / review / attempt yang sudah terbuka agar bisa didiskusikan.
 * Alat ini TIDAK mengirim jawaban. Jangan gunakan selama kuis bernilai sedang berjalan.
 */
export function registerGetQuizQuestions(server: McpServer): void {
  server.tool(
    "get_quiz_questions",
    "Ambil pertanyaan kuis Moodle dari halaman attempt/preview/review yang SUDAH dibuka di browser, untuk dipelajari. Tidak mengirim jawaban.",
    {
      url: z
        .string()
        .url()
        .describe(
          "URL halaman kuis (mod/quiz/view.php, attempt.php, review.php). Preview/review lebih aman — jangan gunakan saat attempt bernilai sedang berjalan."
        ),
      confirmStudyOnly: z
        .boolean()
        .describe(
          "Harus true. Konfirmasi bahwa pengambilan soal ini untuk belajar, bukan untuk pengerjaan kuis bernilai."
        ),
    },
    async ({ url, confirmStudyOnly }) => {
      if (!confirmStudyOnly) {
        return {
          content: [
            {
              type: "text",
              text:
                "Ditolak: alat ini hanya untuk belajar. Set confirmStudyOnly=true dan pastikan Anda TIDAK sedang mengerjakan kuis bernilai.",
            },
          ],
          isError: true,
        };
      }

      try {
        const { html } = await navigateWithRetry(url);
        const $ = load(html);

        const pageType = url.includes("/review.php")
          ? "review"
          : url.includes("/attempt.php")
          ? "attempt"
          : "view";

        const questions: QuizQuestion[] = [];

        $("div.que").each((idx, el) => {
          const $q = $(el);
          const typeClass =
            ($q.attr("class") || "")
              .split(/\s+/)
              .find((c) => c !== "que" && !c.startsWith("de") && !c.startsWith("not"))
              || "unknown";

          const qtext = $q.find(".qtext").first();
          const questionText = qtext.text().trim();
          const questionHtml = qtext.html() || "";

          const options: { label: string; text: string }[] = [];
          $q.find(".answer > div, .answer label").each((__, opt) => {
            const $opt = $(opt);
            const label =
              $opt.find(".answernumber").text().trim().replace(/[.)]$/, "") ||
              String.fromCharCode(97 + options.length);
            const text = $opt.clone().children(".answernumber").remove().end().text().trim();
            if (text) options.push({ label, text });
          });

          const numMatch = $q.find(".info .qno, .info h4").text().trim();
          questions.push({
            number: Number(numMatch) || idx + 1,
            questionHtml,
            questionText,
            type: typeClass,
            options: options.length ? options : undefined,
          });
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url,
                  pageType,
                  count: questions.length,
                  questions,
                  note:
                    "Gunakan untuk belajar saja. Jawaban TIDAK dikirim oleh server ini.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
