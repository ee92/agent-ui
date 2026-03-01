import { useEffect, useState } from "react";
import type { FileEntry, FilePreview } from "../../lib/types";
import { useGatewayStore } from "../../lib/store";
import { fileBreadcrumbs, fileLabelFromPath, formatFileSize } from "../../lib/ui-utils";
import { LoadingSkeleton } from "../ui/loading-skeleton";

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
  const gatewayToken = useGatewayStore((state) => state.gatewayToken);
  const [currentPath, setCurrentPath] = useState("");
  const [cache, setCache] = useState<Record<string, FileEntry[]>>({ "": entries });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [mobilePreviewPath, setMobilePreviewPath] = useState<string | null>(null);

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
        const response = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${gatewayToken}` }
        });
        if (!response.ok) {
          throw new Error("search failed");
        }
        const data = (await response.json()) as {
          results: Array<{ path: string; name: string; type: string; size?: number }>;
        };
        if (!cancelled) {
          setSearchResults(
            data.results.map((entry) => ({
              path: entry.path,
              name: entry.name,
              type: entry.type === "directory" ? "directory" : "file",
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
  }, [gatewayToken, search]);

  useEffect(() => {
    if (preview?.path === openingPath) {
      setOpeningPath(null);
    }
  }, [openingPath, preview?.path]);

  const loadDirectory = async (path: string) => {
    if (cache[path]) {
      setCurrentPath(path);
      return;
    }
    setLoadingDirectory(path);
    try {
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${gatewayToken}` }
      });
      if (!response.ok) {
        throw new Error("list failed");
      }
      const data = (await response.json()) as {
        entries: Array<{
          path: string;
          name: string;
          type: string;
          size?: number;
          childCount?: number;
          mtime?: number | string;
        }>;
      };
      setCache((current) => ({
        ...current,
        [path]: data.entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.type === "directory" ? "directory" : "file",
          depth: 0,
          size: entry.size,
          childCount: entry.childCount,
          mtime: typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString() : entry.mtime
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

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "hidden xl:flex" : "flex"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-3 sm:p-4">
          <div className="mb-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Workspace</p>
                <h3 className="mt-1 text-base font-semibold text-white sm:text-sm">Files</h3>
              </div>
              {loadingDirectory || searching || openingPath ? (
                <span className="inline-flex h-7 items-center rounded-full border border-white/8 px-3 text-[11px] text-zinc-400">
                  Loading
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3">
              <span className="text-sm text-zinc-500">🔎</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search files"
                className="h-12 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />
            </div>
            {!showingSearch ? (
              <div className="scroll-soft flex items-center gap-1 overflow-x-auto pb-1">
                {breadcrumbs.map((crumb, index) => (
                  <button
                    key={crumb.path || "root"}
                    type="button"
                    onClick={() => void loadDirectory(crumb.path)}
                    className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                      index === breadcrumbs.length - 1 ? "bg-white/[0.06] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
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
              <div className="rounded-3xl border border-dashed border-white/8 px-4 py-6 text-sm text-zinc-500">
                Unable to load files right now.
              </div>
            ) : null}
            {ready && !fallback && visibleEntries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/8 px-4 py-6 text-sm text-zinc-500">
                {showingSearch ? "No matching files." : "No files yet. Connect to a workspace to browse files."}
              </div>
            ) : null}
            {visibleEntries.length > 0 ? (
              <div className="space-y-2">
                {visibleEntries.map((entry) => {
                  const isDirectory = entry.type === "directory";
                  const meta = isDirectory
                    ? `${typeof entry.childCount === "number" ? `${entry.childCount} item${entry.childCount === 1 ? "" : "s"}` : "Folder"}`
                    : formatFileSize(entry.size);
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
                      className="flex min-h-14 w-full items-center gap-3 rounded-3xl px-3 py-3 text-left hover:bg-white/[0.04]"
                    >
                      <span className="text-xl">{isDirectory ? "📁" : "📄"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-100">{entry.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{showingSearch ? entry.path : meta}</span>
                      </span>
                      {!showingSearch && !isDirectory ? <span className="text-xs text-zinc-500">{meta}</span> : null}
                      {isDirectory ? <span className="text-lg text-zinc-500">›</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "flex" : "hidden xl:flex"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMobilePreviewPath(null);
                setOpeningPath(null);
              }}
              className="inline-flex h-10 items-center rounded-full border border-white/8 px-3 text-sm text-zinc-300 xl:hidden"
            >
              Back
            </button>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Preview</p>
              <h3 className="mt-1 truncate text-base font-semibold text-white sm:text-sm">
                {mobilePreviewPath ? fileLabelFromPath(mobilePreviewPath) : preview?.path || "Select a file"}
              </h3>
            </div>
          </div>
          <div className="scroll-soft min-h-[360px] flex-1 overflow-auto rounded-3xl border border-white/8 bg-black/30 xl:min-h-0">
            {preview && (preview.path === mobilePreviewPath || !mobilePreviewPath) ? (
              <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-zinc-200 sm:text-sm">
                {preview.content}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-sm text-zinc-500">
                {openingPath ? "Opening file..." : "Choose a file to inspect."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
