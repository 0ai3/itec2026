"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, Puzzle, User } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const item =
    "group relative flex h-12 w-14 items-center justify-center text-[#8b949e] hover:text-white transition-colors";

  const active =
    "text-white before:absolute before:left-0 before:h-5 before:w-[2px] before:bg-[#007acc]";

  const tooltip =
    "absolute left-14 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#161b22] px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 pointer-events-none";

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-14 flex-col bg-[#0d1117] border-r border-[#30363d]">
      <div className="flex items-center justify-center h-12 border-b border-[#21262d]">
        <Link
          href="/"
          className="group relative flex items-center justify-center"
        >
          <div className="h-7 w-7 rounded-md border border-[#30363d] bg-[#161b22] text-[#58a6ff] text-[11px] font-bold grid place-items-center">
            iT
          </div>
          <span className={tooltip}>Home</span>
        </Link>
      </div>

      {/* TOP ICONS */}
      <div className="flex flex-col items-center pt-2">
        <Link
          href="/workspace"
          className={`${item} ${pathname === "/workspace" ? active : ""}`}
        >
          <LayoutDashboard size={20} strokeWidth={1.6} />
          <span className={tooltip}>Dashboard</span>
        </Link>

        <Link
          href="/search"
          className={`${item} ${pathname === "/search" ? active : ""}`}
        >
          <Search size={20} strokeWidth={1.6} />
          <span className={tooltip}>Search</span>
        </Link>

        <Link
          href="/extensions"
          className={`${item} ${pathname === "/extensions" ? active : ""}`}
        >
          <Puzzle size={20} strokeWidth={1.6} />
          <span className={tooltip}>Extensions</span>
        </Link>
      </div>

      {/* SPACER */}
      <div className="flex-1" />

      {/* BOTTOM */}
      <div className="flex flex-col items-center pb-2 border-t border-[#21262d] pt-2">
        <Link
          href="/profile"
          className={`${item} ${pathname === "/profile" ? active : ""}`}
        >
          <User size={20} strokeWidth={1.6} />
          <span className={tooltip}>Profile</span>
        </Link>
      </div>
    </aside>
  );
}
