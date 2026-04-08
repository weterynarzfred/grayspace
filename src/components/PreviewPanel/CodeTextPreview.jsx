import CodeMirror from "@uiw/react-codemirror";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { gruvboxDark } from "@uiw/codemirror-theme-gruvbox-dark";
import { useEffect, useMemo, useState } from "react";

const BASIC_SETUP = {
  foldGutter: false,
  dropCursor: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
};

const previewEditorTheme = EditorView.theme({
  "&.cm-editor": {
    backgroundColor: "#282828",
    color: "#ebdbb2",
  },
  ".cm-scroller": {
    fontFamily: "\"Fira Code\", \"Cascadia Mono\", \"Consolas\", monospace",
    lineHeight: "1.45",
  },
  ".cm-content": {
    padding: "0.75rem",
    minHeight: "3rem",
    caretColor: "#fe8019",
  },
  ".cm-lineNumbers": {
    color: "#7c6f64",
  },
  ".cm-gutters": {
    backgroundColor: "#282828",
    borderRight: "1px solid #504945",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#fe8019",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#504945",
  },
  ".cm-activeLine": {
    backgroundColor: "#32302f",
  },
}, { dark: true });

function getFileName(path) {
  if (typeof path !== "string" || !path) return "";
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function isMarkdownFileName(fileName) {
  return /\.(md|markdown|mdown|mkdn|mkd)$/i.test(fileName);
}

function CodeTextPreview({
  filePath = "",
  content = "",
  className = "",
  readOnly = true,
  onChange = undefined,
  onSave = undefined,
}) {
  const [languageSupport, setLanguageSupport] = useState(null);

  useEffect(() => {
    const fileName = getFileName(filePath);
    if (!fileName) {
      setLanguageSupport(null);
      return undefined;
    }

    if (isMarkdownFileName(fileName)) {
      setLanguageSupport(markdown({ codeLanguages: languages }));
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
    const saveKeymap = typeof onSave === "function"
      ? keymap.of([{
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSave();
          return true;
        },
      }])
      : null;
    const nextExtensions = [
      gruvboxDark,
      previewEditorTheme,
      EditorView.lineWrapping,
    ];
    if (languageSupport) nextExtensions.push(languageSupport);
    if (saveKeymap) nextExtensions.push(saveKeymap);
    return nextExtensions;
  }, [languageSupport, onSave]);

  return <CodeMirror
    key={filePath}
    value={content}
    className={className}
    data-testid="preview-text-content"
    readOnly={readOnly}
    editable={!readOnly}
    basicSetup={BASIC_SETUP}
    extensions={extensions}
    onChange={(nextContent) => {
      if (typeof onChange === "function") onChange(nextContent);
    }}
  />;
}

export default CodeTextPreview;
