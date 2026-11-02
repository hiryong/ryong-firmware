import { getLang, setLang } from "./i18n";

/** One quiet button that switches to the other language, named in that language. */
export const LangToggle = () => {
  const ko = getLang() === "ko";
  return (
    <button className="ry-text ry-lang" lang={ko ? "en" : "ko"} onClick={() => setLang(ko ? "en" : "ko")} title={ko ? "Switch to English" : "한국어로 보기"}>
      {ko ? "English" : "한국어"}
    </button>
  );
};
