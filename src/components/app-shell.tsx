"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hiddenSidebarRoutes = new Set(["/", "/login", "/register", "/signup"]);
  const showSidebar = !hiddenSidebarRoutes.has(pathname);

  return (
    <>
      {showSidebar ? <Sidebar /> : null}
      <div className={showSidebar ? "ml-14 min-h-screen" : "min-h-screen"}>
        {children}
      </div>
    </>
  );
}
