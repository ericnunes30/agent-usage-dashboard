"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { icon: "dashboard", label: "Dashboard", href: "/" },
  { icon: "neurology", label: "Modelos", href: "/models" },
  { icon: "workspaces", label: "Workspaces", href: "/workspaces" },
  { icon: "support_agent", label: "Agentes", href: "/agents" },
];

const bottomItems = [
  { icon: "settings", label: "Configurações", href: "/settings" },
  { icon: "logout", label: "Sair", href: "/logout" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="hidden md:flex flex-col h-screen w-64 bg-surface-container-low border-r border-outline-variant py-8 sticky top-0 shrink-0">
      <div className="px-6 mb-8 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-primary/20 flex items-center justify-center overflow-hidden shrink-0">
          <span className="material-symbols-outlined text-brand-primary text-[18px]">analytics</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-on-surface">Usage</h2>
          <p className="text-xs text-brand-text-muted mt-0.5 uppercase tracking-wider">Agent Analytics</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1 px-4 flex-grow">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto px-4">
        <ul className="flex flex-col gap-1">
          {bottomItems.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-on-surface-variant rounded-lg text-xs font-semibold uppercase tracking-wider hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
