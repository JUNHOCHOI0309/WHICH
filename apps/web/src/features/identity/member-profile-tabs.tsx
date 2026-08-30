import Link from "next/link";
import styles from "./member-profile-tabs.module.css";

export function MemberProfileTabs({
  active,
  creationEnabled = false,
}: {
  active: "profile" | "votes" | "submissions";
  creationEnabled?: boolean;
}) {
  const tabs = [
    { key: "profile", href: "/me", label: "프로필" },
    { key: "votes", href: "/me/votes", label: "투표 기록" },
    ...(creationEnabled || active === "submissions"
      ? [{ key: "submissions", href: "/me/submissions", label: "내 질문" }]
      : []),
  ];
  return (
    <nav className={styles.profileTabs} aria-label="내 기록 메뉴">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={active === tab.key ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
