import CodeMirror from "@uiw/react-codemirror";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";

const previewEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "\"Fira Code\", \"Cascadia Mono\", \"Consolas\", monospace",
    lineHeight: "1.45",
  },
  ".cm-content": {
    padding: "0.75rem",
    minHeight: "3rem",
  },
  ".cm-lineNumbers": {
    color: "#777",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid #444",
  },
}, { dark: true });

function getFileName(path) {
  if (typeof path !== "string" || !path) return "";
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function CodeTextPreview({
  filePath = "",
  content = "",
  className = "",
}) {
  const [languageSupport, setLanguageSupport] = useState(null);

  useEffect(() => {
    const fileName = getFileName(filePath);
    if (!fileName) {
      setLanguageSupport(null);
      return undefined;
    }

    const languageDescription = LanguageDescription.matchFilename(languages, fileName);
    if (!languageDescription) {
      setLanguageSupport(null);
      return undefined;
    }

    let cancelled = false;
    languageDescription.load().then((support) => {
      if (!cancelled) setLanguageSupport(support);
    }).catch(() => {
      if (!cancelled) setLanguageSupport(null);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const extensions = useMemo(() => {
    const nextExtensions = [
      previewEditorTheme,
      EditorView.lineWrapping,
    ];
    if (languageSupport) nextExtensions.push(languageSupport);
    return nextExtensions;
  }, [languageSupport]);

  return (
    <CodeMirror
      key={filePath}
      value={content}
      className={className}
      data-testid="preview-text-content"
      readOnly
      editable={false}
      basicSetup={{
        foldGutter: false,
        dropCursor: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      extensions={extensions}
    />
  );
}

export default CodeTextPreview;
