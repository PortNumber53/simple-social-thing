import React, { createContext, useContext, useState, useMemo } from 'react';

const STORAGE_KEY = 'sst-sidebar-collapsed';

interface SidebarContextValue {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() => readCollapsed());
  const [isMobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  };

  const value = useMemo<SidebarContextValue>(
    () => ({ isCollapsed, isMobileOpen, toggle, setMobileOpen }),
    [isCollapsed, isMobileOpen],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
