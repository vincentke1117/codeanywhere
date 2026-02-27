"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavRail } from "./NavRail";
import { ChatListPanel } from "./ChatListPanel";
import { RightPanel } from "./RightPanel";
import { ResizeHandle } from "./ResizeHandle";
import { DocPreview } from "./DocPreview";
import { Header } from "./Header";
import { MobileDrawer } from "./MobileDrawer";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";
import { authFetch } from "@/lib/api-client";

const CHATLIST_MIN = 180;
const CHATLIST_MAX = 400;
const RIGHTPANEL_MIN = 200;
const RIGHTPANEL_MAX = 480;
const DOCPREVIEW_MIN = 320;
const DOCPREVIEW_MAX = 800;

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, parsed));
}

/** Extensions that default to "rendered" view mode */
const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

const LG_BREAKPOINT = 1024;
const MD_BREAKPOINT = 768;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [chatListOpen, setChatListOpenRaw] = useState(false);

  // Mobile responsive state
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(() => {
    return readStoredNumber("codeanywhere_chatlist_width", 240, CHATLIST_MIN, CHATLIST_MAX);
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    return readStoredNumber("codeanywhere_rightpanel_width", 288, RIGHTPANEL_MIN, RIGHTPANEL_MAX);
  });

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.min(CHATLIST_MAX, Math.max(CHATLIST_MIN, w + delta)));
  }, []);
  const handleChatListResizeEnd = useCallback(() => {
    setChatListWidth((w) => {
      localStorage.setItem("codeanywhere_chatlist_width", String(w));
      return w;
    });
  }, []);

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.min(RIGHTPANEL_MAX, Math.max(RIGHTPANEL_MIN, w - delta)));
  }, []);
  const handleRightPanelResizeEnd = useCallback(() => {
    setRightPanelWidth((w) => {
      localStorage.setItem("codeanywhere_rightpanel_width", String(w));
      return w;
    });
  }, []);

  // Panel state
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const isChatDetailRoute = pathname.startsWith("/chat/");

  // Auto-close chat list when leaving chat routes
  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  useEffect(() => {
    if (!isChatRoute) {
      setChatListOpenRaw(false);
    }
  }, [isChatRoute]);
  // Mobile breakpoint detection
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setDrawerOpen(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  const [panelOpen, setPanelOpenRaw] = useState(false);
  const [panelContent, setPanelContent] = useState<PanelContent>("files");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  // --- Doc Preview state ---
  const [previewFile, setPreviewFileRaw] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");
  const [docPreviewWidth, setDocPreviewWidth] = useState(() => {
    return readStoredNumber("codeanywhere_docpreview_width", 480, DOCPREVIEW_MIN, DOCPREVIEW_MAX);
  });

  const setPreviewFile = useCallback((path: string | null) => {
    setPreviewFileRaw(path);
    if (path) {
      setPreviewViewMode(defaultViewMode(path));
    }
  }, []);

  const handleDocPreviewResize = useCallback((delta: number) => {
    setDocPreviewWidth((w) => Math.min(DOCPREVIEW_MAX, Math.max(DOCPREVIEW_MIN, w - delta)));
  }, []);
  const handleDocPreviewResizeEnd = useCallback(() => {
    setDocPreviewWidth((w) => {
      localStorage.setItem("codeanywhere_docpreview_width", String(w));
      return w;
    });
  }, []);

  // Auto-open panel on chat detail routes, close on others
  // Also close doc preview when navigating away or switching sessions
  useEffect(() => {
    setPanelOpenRaw(isChatDetailRoute);
    setPreviewFileRaw(null);
  }, [isChatDetailRoute, pathname]);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenRaw(open);
  }, []);

  // Keep chat list state in sync when resizing across the breakpoint (only on chat routes)
  useEffect(() => {
    if (!isChatRoute) return;
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    setChatListOpenRaw(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [isChatRoute]);

  // --- Skip-permissions indicator ---
  const [skipPermissionsActive, setSkipPermissionsActive] = useState(false);

  const fetchSkipPermissions = useCallback(async () => {
    try {
      const res = await authFetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        setSkipPermissionsActive(data.settings?.dangerously_skip_permissions === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  // Re-fetch when window gains focus / becomes visible instead of polling every 5s
  useEffect(() => {
    fetchSkipPermissions();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchSkipPermissions();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", fetchSkipPermissions);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", fetchSkipPermissions);
    };
  }, [fetchSkipPermissions]);

  const panelContextValue = useMemo(
    () => ({
      panelOpen,
      setPanelOpen,
      panelContent,
      setPanelContent,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [panelOpen, setPanelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, previewFile, setPreviewFile, previewViewMode]
  );

  return (
    <PanelContext.Provider value={panelContextValue}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden">
          {isMobile ? (
            <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left">
              <div className="flex h-full">
                <NavRail
                  chatListOpen={chatListOpen}
                  onToggleChatList={() => setChatListOpen(!chatListOpen)}
                  skipPermissionsActive={skipPermissionsActive}
                />
                <ChatListPanel open={chatListOpen} width={chatListWidth} />
              </div>
            </MobileDrawer>
          ) : (
            <>
              <NavRail
                chatListOpen={chatListOpen}
                onToggleChatList={() => setChatListOpen(!chatListOpen)}
                skipPermissionsActive={skipPermissionsActive}
              />
              <ChatListPanel open={chatListOpen} width={chatListWidth} />
              {chatListOpen && (
                <ResizeHandle side="left" onResize={handleChatListResize} onResizeEnd={handleChatListResizeEnd} />
              )}
            </>
          )}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined} />
            <main className="relative flex-1 overflow-hidden">{children}</main>
          </div>
          {!isMobile && isChatDetailRoute && previewFile && (
            <ResizeHandle side="right" onResize={handleDocPreviewResize} onResizeEnd={handleDocPreviewResizeEnd} />
          )}
          {!isMobile && isChatDetailRoute && previewFile && (
            <DocPreview
              filePath={previewFile}
              viewMode={previewViewMode}
              onViewModeChange={setPreviewViewMode}
              onClose={() => setPreviewFile(null)}
              width={docPreviewWidth}
            />
          )}
          {!isMobile && isChatDetailRoute && panelOpen && (
            <ResizeHandle side="right" onResize={handleRightPanelResize} onResizeEnd={handleRightPanelResizeEnd} />
          )}
          {!isMobile && isChatDetailRoute && <RightPanel width={rightPanelWidth} />}
          {isMobile && isChatDetailRoute && (
            <MobileDrawer open={panelOpen} onClose={() => setPanelOpen(false)} side="bottom">
              <div className="h-[70vh] overflow-auto">
                <RightPanel />
              </div>
            </MobileDrawer>
          )}
        </div>
      </TooltipProvider>
    </PanelContext.Provider>
  );
}
