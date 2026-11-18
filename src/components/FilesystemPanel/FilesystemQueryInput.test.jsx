import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import FilesystemQueryInput from "./FilesystemQueryInput";
import { DEFAULT_SEARCH_OPTIONS, DEFAULT_SKIPPED_FOLDER_NAMES } from "./filesystemSearchOptions";

function SearchBox({ value = "", onClose = vi.fn() }) {
  const [searchOptions, setSearchOptions] = useState(DEFAULT_SEARCH_OPTIONS);
  return <FilesystemQueryInput
    mode="search"
    value={value}
    focusRequestKey={0}
    searchOptions={searchOptions}
    onChange={vi.fn()}
    onSearchOptionsChange={(patch) => setSearchOptions((current) => ({ ...current, ...patch }))}
    onModeChange={vi.fn()}
    onClose={onClose}
    onSubmit={vi.fn()}
  />;
}

function openOptionsPanel() {
  fireEvent.click(screen.getByRole("button", { name: "Search options" }));
  return screen.getByRole("group", { name: "Search options" });
}

describe("FilesystemQueryInput search options", () => {
  it("toggles regex on the relative path from the .* button", () => {
    render(<SearchBox />);
    const regexToggle = screen.getByRole("button", { name: "Use regular expression" });
    expect(regexToggle).toHaveAttribute("aria-pressed", "false");
    expect(regexToggle).toHaveAttribute("title", "Regex on the path relative to this folder, / between folders");

    fireEvent.click(regexToggle);

    expect(regexToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Regex on relative path");
  });

  it("keeps an empty box open while focus moves to its options and closes it when focus leaves", () => {
    const onClose = vi.fn();
    render(<SearchBox onClose={onClose} />);
    const searchInput = screen.getByRole("searchbox");
    const optionsButton = screen.getByRole("button", { name: "Search options" });

    fireEvent.blur(searchInput, { relatedTarget: optionsButton });
    const panel = openOptionsPanel();
    fireEvent.blur(optionsButton, { relatedTarget: panel });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.blur(panel, { relatedTarget: null });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not reformat the skip list while typing and commits it on blur", () => {
    render(<SearchBox />);
    openOptionsPanel();
    const namesInput = screen.getByRole("textbox", { name: "Folder names to skip, comma-separated" });
    expect(namesInput).toHaveValue(DEFAULT_SKIPPED_FOLDER_NAMES.join(", "));
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();

    fireEvent.change(namesInput, { target: { value: "node_modules, , dist, " } });
    expect(namesInput).toHaveValue("node_modules, , dist, ");

    fireEvent.blur(namesInput);
    expect(namesInput).toHaveValue("node_modules, dist");
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeEnabled();
  });

  it("keeps a typed skip list when a click outside closes the options panel", () => {
    render(<SearchBox value="todo" />);
    openOptionsPanel();
    const namesInput = screen.getByRole("textbox", { name: "Folder names to skip, comma-separated" });
    namesInput.focus();
    fireEvent.change(namesInput, { target: { value: "dist, target" } });

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("group", { name: "Search options" })).not.toBeInTheDocument();
    openOptionsPanel();
    expect(screen.getByRole("textbox", { name: "Folder names to skip, comma-separated" })).toHaveValue("dist, target");
  });

  it("commits the skip list on Enter and toggles the skip options", () => {
    render(<SearchBox />);
    openOptionsPanel();
    const namesInput = screen.getByRole("textbox", { name: "Folder names to skip, comma-separated" });
    const skipFolders = screen.getByRole("checkbox", { name: "Skip folders" });
    const skipCacheDirTagged = screen.getByRole("checkbox", { name: /CACHEDIR\.TAG/ });
    expect(skipFolders).toBeChecked();
    expect(skipCacheDirTagged).not.toBeChecked();

    fireEvent.change(namesInput, { target: { value: "target,dist" } });
    fireEvent.keyDown(namesInput, { key: "Enter" });
    fireEvent.click(skipFolders);
    fireEvent.click(skipCacheDirTagged);

    expect(namesInput).toHaveValue("target, dist");
    expect(skipFolders).not.toBeChecked();
    expect(skipCacheDirTagged).toBeChecked();
  });

  it("resets every option to its default", () => {
    render(<SearchBox />);
    fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
    openOptionsPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip folders" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /CACHEDIR\.TAG/ }));
    const namesInput = screen.getByRole("textbox", { name: "Folder names to skip, comma-separated" });
    fireEvent.change(namesInput, { target: { value: "dist" } });
    fireEvent.blur(namesInput);

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    expect(screen.getByRole("button", { name: "Use regular expression" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("checkbox", { name: "Skip folders" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /CACHEDIR\.TAG/ })).not.toBeChecked();
    expect(namesInput).toHaveValue(DEFAULT_SKIPPED_FOLDER_NAMES.join(", "));
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });

  it("moves focus to the options panel before Reset disables itself, keeping an empty box open", () => {
    const onClose = vi.fn();
    render(<SearchBox onClose={onClose} />);
    const panel = openOptionsPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /CACHEDIR\.TAG/ }));
    const resetButton = screen.getByRole("button", { name: "Reset to defaults" });
    resetButton.focus();

    fireEvent.click(resetButton);

    expect(resetButton).toBeDisabled();
    expect(panel).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the options panel outside the search box and keeps it open for clicks inside it", () => {
    const { container } = render(<SearchBox />);
    const panel = openOptionsPanel();
    expect(container.contains(panel)).toBe(false);

    fireEvent.pointerDown(screen.getByRole("checkbox", { name: "Skip folders" }));

    expect(screen.getByRole("group", { name: "Search options" })).toBeInTheDocument();
  });

  it("closes the options panel on Escape and returns focus to its button", () => {
    render(<SearchBox />);
    openOptionsPanel();
    const optionsButton = screen.getByRole("button", { name: "Search options" });
    expect(optionsButton).toHaveAttribute("aria-expanded", "true");
    const skipFolders = screen.getByRole("checkbox", { name: "Skip folders" });
    skipFolders.focus();

    fireEvent.keyDown(skipFolders, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "Search options" })).not.toBeInTheDocument();
    expect(optionsButton).toHaveAttribute("aria-expanded", "false");
    expect(optionsButton).toHaveFocus();
  });

  it("shows no search options in filter mode", () => {
    render(<FilesystemQueryInput
      mode="filter"
      value=""
      focusRequestKey={0}
      searchOptions={DEFAULT_SEARCH_OPTIONS}
      onChange={vi.fn()}
      onSearchOptionsChange={vi.fn()}
      onModeChange={vi.fn()}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.queryByRole("button", { name: "Use regular expression" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search options" })).not.toBeInTheDocument();
  });
});
