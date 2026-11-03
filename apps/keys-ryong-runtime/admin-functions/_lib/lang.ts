// Messages for the admin screen in English or Korean. The page sends X-Ryong-Lang (its "ryong.lang" choice);
// without it the server answers in Korean, as it always did.

export type Lang = "en" | "ko";
export const langOf = (request: Request): Lang => (request.headers.get("X-Ryong-Lang") === "en" ? "en" : "ko");

/** msg(request, "English", "한국어") — the text in the language the page asked for. */
export const msg = (from: Request | Lang, en: string, ko: string) => ((typeof from === "string" ? from : langOf(from)) === "en" ? en : ko);

/** An error for the person, in both languages. `message` stays Korean; `en` carries the English text. */
export class BiError extends Error {
  constructor(public en: string, ko: string) { super(ko); }
}
export function fail(en: string, ko: string): never { throw new BiError(en, ko); }

/** The text of a thrown error in the asked language (errors without an English text keep their message). */
export const errText = (e: unknown, lang: Lang) => {
  const x = e as { en?: unknown; message?: string };
  return lang === "en" && typeof x?.en === "string" ? x.en : x?.message ?? "";
};
