import { render, screen, waitFor } from "@testing-library/react";
import CodeTextPreview from "./CodeTextPreview";

const codeMirrorPropsRef = {
  current: null,
};
const languageSupportMock = { languageName: "javascript" };
const markdownSupportMock = { languageName: "markdown" };
const loadLanguageMock = vi.fn(async () => languageSupportMock);
const markdownMock = vi.fn(() => markdownSupportMock);
const matchFilenameMock = vi.fn((_, fileName) => {
  if (fileName === "app.js") {
    return { load: loadLanguageMock };
  }
  return null;
});

vi.mock("@uiw/react-codemirror", () => ({
  default: (props) => {
    codeMirrorPropsRef.current = props;
    return <div data-testid="codemirror-proxy">{props.value}</div>;
  },
}));

vi.mock("@codemirror/language", () => ({
  LanguageDescription: {
    matchFilename: (...args) => matchFilenameMock(...args),
  },
}));

vi.mock("@codemirror/language-data", () => ({
  languages: [{ name: "javascript" }],
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: (...args) => markdownMock(...args),
}));

vi.mock("@codemirror/view", () => ({
  keymap: {
    of: vi.fn((bindings) => ({ keymap: bindings })),
  },
  EditorView: {
    theme: () => ({ theme: "preview" }),
    lineWrapping: { extension: "lineWrapping" },
  },
}));

describe("CodeTextPreview", () => {
  beforeEach(() => {
    codeMirrorPropsRef.current = null;
    loadLanguageMock.mockClear();
    markdownMock.mockClear();
    matchFilenameMock.mockClear();
  });

  it("renders value in read-only mode", () => {
    render(
      <CodeTextPreview
        filePath="C:\\notes.txt"
        content="hello world"
        className="preview-class"
      />,
    );

    expect(screen.getByTestId("codemirror-proxy")).toHaveTextContent("hello world");
    expect(codeMirrorPropsRef.current.readOnly).toBe(true);
    expect(codeMirrorPropsRef.current.editable).toBe(false);
    expect(codeMirrorPropsRef.current.className).toBe("preview-class");
  });

  it("can be switched into editable mode", () => {
    render(
      <CodeTextPreview
        filePath="C:\\notes.txt"
        content="editable text"
        readOnly={false}
      />,
    );

    expect(codeMirrorPropsRef.current.readOnly).toBe(false);
    expect(codeMirrorPropsRef.current.editable).toBe(true);
  });

  it("loads language support based on filename", async () => {
    render(
      <CodeTextPreview
        filePath="C:\\workspace\\app.js"
        content="const x = 1;"
      />,
    );

    await waitFor(() => {
      expect(loadLanguageMock).toHaveBeenCalledTimes(1);
    });

    expect(matchFilenameMock).toHaveBeenCalledWith(
      expect.any(Array),
      "app.js",
    );
    expect(codeMirrorPropsRef.current.extensions).toContain(languageSupportMock);
  });

  it("configures markdown fenced code highlighting", async () => {
    render(
      <CodeTextPreview
        filePath="C:\\workspace\\notes.md"
        content={"```js\nconst x = 1;\n```"}
      />,
    );

    await waitFor(() => {
      expect(markdownMock).toHaveBeenCalledTimes(1);
    });
    expect(markdownMock).toHaveBeenCalledWith(expect.objectContaining({
      codeLanguages: expect.any(Array),
    }));
    expect(matchFilenameMock).not.toHaveBeenCalled();
    expect(codeMirrorPropsRef.current.extensions).toContain(markdownSupportMock);
  });
});
