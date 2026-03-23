import { useEffect, useRef, useState } from "react";
import type { FileEntry, FilePreview } from "../../lib/types";
import { useAdapterStore } from "../../lib/adapters";
import { fileBreadcrumbs, fileLabelFromPath, formatFileSize } from "../../lib/ui-utils";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import { JsonViewer } from "./json-viewer";
import { MarkdownViewer } from "./markdown-viewer";

function formatEntryDate(value?: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function FileBrowser({
  entries,
  ready,
  fallback,
  preview,
  onOpen
}: {
  entries: FileEntry[];
  ready: boolean;
  fallback: boolean;
  preview: FilePreview | null;
  onOpen: (path: string) => Promise<void>;
}) {
  const adapter = useAdapterStore((state) => state.adapter);
  const [currentPath, setCurrentPath] = useState("");
  const [cache, setCache] = useState<Record<string, FileEntry[]>>({ "": entries });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [mobilePreviewPath, setMobilePreviewPath] = useState<string | null>(null);
  const [previewSearch, setPreviewSearch] = useState("");
  const [activePreviewMatch, setActivePreviewMatch] = useState(0);
  const [previewMatchCount, setPreviewMatchCount] = useState(0);
  const previewSearchInputRef = useRef<HTMLInputElement | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCache({ "": entries });
    setCurrentPath("");
    setSearch("");
    setSearchResults([]);
    setLoadingDirectory(null);
    setOpeningPath(null);
    setMobilePreviewPath(null);
  }, [entries]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setSearching(false);
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearching(true);
      try {
        const results = adapter.files.search
          ? await adapter.files.search(query)
          : (await adapter.files.list("")).filter((entry) =>
              entry.path.toLowerCase().includes(query.toLowerCase()) || entry.name.toLowerCase().includes(query.toLowerCase())
            );
        if (!cancelled) {
          setSearchResults(
            results.map((entry) => ({
              path: entry.path,
              name: entry.name,
              type: entry.isDirectory ? "directory" : "file",
              depth: 0,
              size: entry.size
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [adapter, search]);

  useEffect(() => {
    if (preview?.path === openingPath) {
      setOpeningPath(null);
    }
  }, [openingPath, preview?.path]);

  useEffect(() => {
    setPreviewSearch("");
    setActivePreviewMatch(0);
    setPreviewMatchCount(0);
  }, [preview?.path]);

  useEffect(() => {
    if (!preview) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        previewSearchInputRef.current?.focus();
        previewSearchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview]);

  useEffect(() => {
    const container = previewContentRef.current;
    if (!container) {
      setPreviewMatchCount(0);
      setActivePreviewMatch(0);
      return;
    }

    const applyHighlights = () => {
      const highlightedNodes = Array.from(container.querySelectorAll("span[data-file-search-match='true']"));
      for (const node of highlightedNodes) {
        const parent = node.parentNode;
        if (!parent) {
          continue;
        }
        parent.replaceChild(document.createTextNode(node.textContent ?? ""), node);
        parent.normalize();
      }

      const query = previewSearch.trim();
      if (!query) {
        setPreviewMatchCount(0);
        setActivePreviewMatch(0);
        return;
      }

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          const parentElement = node.parentElement;
          if (!parentElement) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parentElement.closest("script, style")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parentElement.dataset.fileSearchMatch === "true") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const textNodes: Text[] = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }

      const regex = new RegExp(escapeRegExp(query), "gi");
      let matchTotal = 0;

      for (const textNode of textNodes) {
        const text = textNode.nodeValue ?? "";
        regex.lastIndex = 0;
        const matches = [...text.matchAll(regex)];
        if (!matches.length) {
          continue;
        }

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of matches) {
          const startIndex = match.index ?? 0;
          const matchedText = match[0];
          if (startIndex > lastIndex) {
            fragment.append(text.slice(lastIndex, startIndex));
          }
          const highlight = document.createElement("span");
          highlight.dataset.fileSearchMatch = "true";
          highlight.className = "rounded bg-amber-300/30 px-0.5 text-amber-100";
          highlight.textContent = matchedText;
          fragment.append(highlight);
          lastIndex = startIndex + matchedText.length;
          matchTotal += 1;
        }

        if (lastIndex < text.length) {
          fragment.append(text.slice(lastIndex));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
      }

      setPreviewMatchCount(matchTotal);
      setActivePreviewMatch((current) => {
        if (matchTotal === 0) {
          return 0;
        }
        return current >= matchTotal ? 0 : current;
      });
    };

    let disconnected = false;
    let observer: MutationObserver | null = null;
    const runHighlights = () => {
      if (disconnected) {
        return;
      }
      observer?.disconnect();
      applyHighlights();
      if (!disconnected && observer) {
        observer.observe(container, { childList: true, subtree: true, characterData: true });
      }
    };

    const timeoutId = window.setTimeout(runHighlights, 0);
    observer = new MutationObserver(() => runHighlights());
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      disconnected = true;
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [preview?.content, preview?.path, previewSearch]);

  useEffect(() => {
    const container = previewContentRef.current;
    if (!container) {
      return;
    }
    const matches = Array.from(container.querySelectorAll("span[data-file-search-match='true']")) as HTMLSpanElement[];
    for (const [index, match] of matches.entries()) {
      if (index === activePreviewMatch) {
        match.className = "rounded bg-amber-300 px-0.5 text-zinc-950";
      } else {
        match.className = "rounded bg-amber-300/30 px-0.5 text-amber-100";
      }
    }
    if (matches.length > 0 && matches[activePreviewMatch]) {
      matches[activePreviewMatch].scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [activePreviewMatch, previewMatchCount]);

  const loadDirectory = async (path: string) => {
    if (cache[path]) {
      setCurrentPath(path);
      return;
    }
    setLoadingDirectory(path);
    try {
      const data = await adapter.files.list(path);
      setCache((current) => ({
        ...current,
        [path]: data.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.isDirectory ? "directory" : "file",
          depth: 0,
          size: entry.size,
          childCount: undefined,
          mtime: entry.modifiedAt
        }))
      }));
      setCurrentPath(path);
    } finally {
      setLoadingDirectory((current) => (current === path ? null : current));
    }
  };

  const openPreview = async (path: string) => {
    setOpeningPath(path);
    setMobilePreviewPath(path);
    await onOpen(path);
  };

  const visibleEntries = search.trim().length >= 2 ? searchResults : cache[currentPath] ?? [];
  const breadcrumbs = fileBreadcrumbs(currentPath);
  const showingSearch = search.trim().length >= 2;
  const previewingFile = preview && (preview.path === mobilePreviewPath || !mobilePreviewPath);
  const previewPath = previewingFile ? preview.path.toLowerCase() : "";

  const movePreviewMatch = (direction: 1 | -1) => {
    if (previewMatchCount === 0) {
      return;
    }
    setActivePreviewMatch((current) => (current + direction + previewMatchCount) % previewMatchCount);
  };

  const renderPreviewContent = () => {
    if (!previewingFile) {
      return null;
    }
    if (previewPath.endsWith(".md")) {
      return <MarkdownViewer content={preview.content} />;
    }
    if (previewPath.endsWith(".json")) {
      return <JsonViewer content={preview.content} />;
    }
    return (
      <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-zinc-200 sm:text-sm">
        {preview.content}
      </pre>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "hidden xl:flex" : "flex"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/[0.06] bg-surface-0 p-3 sm:p-4">
          <div className="mb-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">Workspace</p>
                <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-zinc-100">Files</h3>
              </div>
              {loadingDirectory || searching || openingPath ? (
                <span className="inline-flex h-7 items-center rounded-full border border-white/[0.06] px-3 text-[10px] text-zinc-400">
                  Loading
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-transparent bg-white/[0.04] px-3 transition-colors focus-within:border-white/[0.1] focus-within:bg-white/[0.06]">
              <span className="text-sm text-zinc-600">🔎</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search files"
                className="h-9 w-full bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </div>
            {!showingSearch ? (
              <div className="scroll-soft flex items-center gap-0.5 overflow-x-auto pb-1">
                {breadcrumbs.map((crumb, index) => (
                  <button
                    key={crumb.path || "root"}
                    type="button"
                    onClick={() => void loadDirectory(crumb.path)}
                    className={`shrink-0 rounded-md px-2 py-1 text-[12px] transition ${
                      index === breadcrumbs.length - 1 ? "bg-white/[0.06] font-medium text-zinc-200" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                    }`}
                  >
                    {crumb.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="scroll-soft min-h-[320px] flex-1 overflow-y-auto pr-1 xl:min-h-0">
            {!ready && !cache[""]?.length ? <LoadingSkeleton rows={5} /> : null}
            {ready && fallback && !cache[""]?.length ? (
              <div className="rounded-lg border border-dashed border-white/[0.06] px-4 py-5 text-[13px] text-zinc-600">
                Unable to load files right now.
              </div>
            ) : null}
            {ready && !fallback && visibleEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.06] px-4 py-5 text-[13px] text-zinc-600">
                {showingSearch ? "No matches" : "Empty directory"}
              </div>
            ) : null}
            {visibleEntries.length > 0 ? (
              <div className="space-y-2">
                {visibleEntries.map((entry) => {
                  const isDirectory = entry.type === "directory";
                  const meta = isDirectory
                    ? `${typeof entry.childCount === "number" ? `${entry.childCount} item${entry.childCount === 1 ? "" : "s"}` : "Folder"}`
                    : formatFileSize(entry.size);
                  const modifiedDate = !isDirectory ? formatEntryDate(entry.mtime) : null;
                  return (
                    <button
                      key={`${showingSearch ? "search" : currentPath}:${entry.path}`}
                      type="button"
                      onClick={() => {
                        if (isDirectory) {
                          setSearch("");
                          void loadDirectory(entry.path);
                          return;
                        }
                        void openPreview(entry.path);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.04]"
                    >
                      <span className="text-base">{isDirectory ? "📁" : "📄"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-100">{entry.name}</span>
                        <span className="block truncate text-[11px] text-zinc-600">{showingSearch ? entry.path : meta}{!showingSearch && modifiedDate ? ` · ${modifiedDate}` : ""}</span>
                      </span>
                      {isDirectory ? <span className="text-sm text-zinc-600">›</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "flex" : "hidden xl:flex"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/[0.06] bg-surface-0 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMobilePreviewPath(null);
                setOpeningPath(null);
              }}
              className="inline-flex h-8 items-center rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 text-[13px] text-zinc-400 xl:hidden"
            >
              ← Back
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">Preview</p>
              <h3 className="mt-0.5 truncate text-[13px] font-semibold text-zinc-100">
                {mobilePreviewPath ? fileLabelFromPath(mobilePreviewPath) : preview?.path || "Select a file"}
              </h3>
            </div>
          </div>
          {previewingFile ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-transparent bg-white/[0.04] px-3 py-1.5 transition-colors focus-within:border-white/[0.1] focus-within:bg-white/[0.06]">
              <input
                ref={previewSearchInputRef}
                value={previewSearch}
                onChange={(event) => {
                  setPreviewSearch(event.target.value);
                  setActivePreviewMatch(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    movePreviewMatch(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Search in file…"
                className="h-8 min-w-[180px] flex-1 bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <span className="text-[11px] tabular-nums text-zinc-600">
                {previewMatchCount > 0
                  ? `${Math.min(activePreviewMatch + 1, previewMatchCount)}/${previewMatchCount}`
                  : previewSearch.trim()
                    ? "0"
                    : ""}
              </span>
            </div>
          ) : null}
          <div className="scroll-soft min-h-[360px] flex-1 overflow-auto rounded-lg border border-white/[0.05] bg-white/[0.02] xl:min-h-0">
            {previewingFile ? (
              <div ref={previewContentRef} className="min-h-full">
                {renderPreviewContent()}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-[13px] text-zinc-700">
                {openingPath ? "Loading…" : "Select a file to preview"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
