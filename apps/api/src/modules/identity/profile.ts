export function publicProfileInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return (
    (words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      : words[0]?.slice(0, 2)) || "W"
  );
}
