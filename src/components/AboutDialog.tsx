// lucide-react v1 dropped brand marks (including Github). Using GitBranch as
// a domain-appropriate replacement — the About dialog just needs a hint that
// the link is a source repo, and this one reads instantly for developers.
import { Info, GitBranch } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { interceptExternal } from "@/lib/platform";
import { commitUrl, formatBuildLabel } from "@/lib/buildInfo";

// Section ids — order is the display order; the heading/body text lives in the
// `landing` locale (about.sections.<id>).
const SECTION_IDS = ["offline", "data", "community", "oss"] as const;

// Open-source repositories — shown under the "Free & Open Source" section. Repo
// names are proper nouns, intentionally not translated. RacePlex comes first:
// it is the app you are running. The rest are upstream's, which RacePlex is a
// GPL-3.0 fork of and which it still credits.
const GITHUB_LINKS: Array<{ href: string; label: string }> = [
  { href: "https://github.com/beadon/RacePlex", label: "RacePlex" },
  { href: "https://github.com/TheAngryRaven/DovesDataViewer", label: "DataViewer (upstream)" },
  { href: "https://github.com/TheAngryRaven/DovesDataLogger", label: "Datalogger" },
  { href: "https://github.com/TheAngryRaven/DovesLapTimer", label: "Timer Library" },
];

export function AboutDialog() {
  const { t } = useTranslation("landing");
  const features = t("about.features", { returnObjects: true }) as string[];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="w-4 h-4" />
          <span className="hidden sm:inline">{t("about.trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("about.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          {SECTION_IDS.map((id) => (
            <div key={id}>
              <h3 className="font-semibold text-foreground mb-1">{t(`about.sections.${id}.heading`)}</h3>
              <p>
                <Trans
                  t={t}
                  i18nKey={`about.sections.${id}.body`}
                  components={{ strong: <strong className="text-foreground" /> }}
                />
              </p>
            </div>
          ))}

          {/* Source repos — sits with the open-source section, above the feature list. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {GITHUB_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => interceptExternal(e, link.href)}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <GitBranch className="w-4 h-4" />
                <span className="text-xs">{link.label}</span>
              </a>
            ))}
          </div>

          <div className="border-t border-border pt-4 mt-4">
            <h3 className="font-semibold text-foreground mb-2">{t("about.featuresHeading")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {features.map((feat, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Which build am I actually running? `formatBuildLabel` has existed
              (and been tested) all along, but its only host was the landing-page
              footer, which the Dashboard replaced — so the deployed app showed
              its version nowhere. This is that stamp's home now. */}
          <BuildStamp />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Version + commit of this build, linking to the exact commit on GitHub. */
function BuildStamp() {
  const label = formatBuildLabel();
  if (!label) return null; // no tag and no hash — say nothing rather than invent one
  const href = commitUrl();

  return (
    <div className="border-t border-border pt-3 mt-4 flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Version</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => interceptExternal(e, href)}
          className="font-mono text-foreground hover:text-primary transition-colors"
        >
          {label}
        </a>
      ) : (
        <span className="font-mono text-foreground">{label}</span>
      )}
    </div>
  );
}
