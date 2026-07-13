import { useState } from "react";
import { User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileAvatarProps {
  /** Public avatar URL (with cache-buster), or null for the placeholder. */
  url: string | null | undefined;
  alt?: string;
  /** Tailwind size classes for the circle (e.g. "h-12 w-12"). */
  sizeClassName?: string;
  className?: string;
}

/**
 * Round avatar with a UserIcon fallback. Presentational only — shared by the
 * profile panel, the driver page, and the leaderboard rows so they stay visually
 * identical. The icon scales to roughly half the circle.
 */
export function ProfileAvatar({ url, alt = "", sizeClassName = "h-12 w-12", className }: ProfileAvatarProps) {
  // Fall back to the placeholder when the avatar object 404s (swept path or a
  // transient CDN miss) instead of rendering the browser's broken-image glyph.
  // Override is stamped against the url that failed, so a fresh upload (new ?v=
  // buster changes the url) auto-invalidates the failure state.
  const [failedForUrl, setFailedForUrl] = useState<string | null>(null);
  const failed = failedForUrl === url;
  const markFailed = () => setFailedForUrl(url ?? null);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground",
        sizeClassName,
        className,
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={markFailed}
        />
      ) : (
        <UserIcon className="h-1/2 w-1/2" />
      )}
    </div>
  );
}
